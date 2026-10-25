/**
 * Framework-agnostic game client: owns the socket, the prediction state and the interpolation
 * buffers, and publishes HUD state. The Phaser scene reads from it every frame.
 */
import { collisionLookup, type SolidFn } from "@/shared/physics";
import { Predictor } from "@/shared/prediction";
import { InterpolationBuffer } from "@/shared/interpolation";
import type {
  ClientMsg,
  Constants,
  ContestantDTO,
  GameEventDTO,
  MapDTO,
  MatchResult,
  ServerMsg,
  SnapshotDTO,
} from "@/shared/protocol";
import { formatEvent, rejectionText } from "@/lib/feed";
import type { HudStore } from "@/lib/store";

export interface JoinParams {
  name: string;
  archetype: string;
  bots: number;
}

function serverHost(): { host: string; secure: boolean } {
  if (typeof window === "undefined") return { host: "localhost:8000", secure: false };
  return { host: `${window.location.hostname}:8000`, secure: window.location.protocol === "https:" };
}

/** WebSocket base URL of the game server. */
export function serverUrl(): string {
  const env = process.env.NEXT_PUBLIC_ARENIX_WS;
  if (env) return env;
  const { host, secure } = serverHost();
  return `${secure ? "wss" : "ws"}://${host}`;
}

/** HTTP base URL of the game server (derived from the WebSocket URL). */
export function apiUrl(): string {
  return serverUrl().replace(/^ws/, "http");
}

export function practiceUrl(p: JoinParams): string {
  const q = new URLSearchParams({ name: p.name, archetype: p.archetype, bots: String(p.bots) });
  return `${serverUrl()}/ws/practice?${q}`;
}

export function roomUrl(code: string, token: string): string {
  return `${serverUrl()}/ws/rooms/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}`;
}

const CLOSE_REASONS: Record<number, string> = {
  4400: "The server rejected your name or character.",
  4401: "Your seat in this room has expired. Join again from the room link.",
  4404: "This room no longer exists.",
  4408: "Disconnected after too many invalid messages.",
};
const MAX_RECONNECTS = 5;

type EventListener = (ev: GameEventDTO) => void;

export class GameClient {
  map: MapDTO | null = null;
  constants: Constants | null = null;
  you: string | null = null;
  solid: SolidFn = () => true;
  predictor: Predictor | null = null;
  snapshot: SnapshotDTO | null = null;
  /** Position before the most recent local prediction step (for render smoothing). */
  prev = { x: 0, y: 0 };
  /** Visual offset left over from a reconciliation snap; decays to zero. */
  correction = { x: 0, y: 0 };
  readonly buffers = new Map<string, InterpolationBuffer>();
  private ws: WebSocket | null = null;
  private url = "";
  private feedId = 0;
  private toastId = 0;
  private lastInteract = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnects = 0;
  private closedByUs = false;
  private snapshotCount = 0;
  private listeners = new Set<EventListener>();
  private names: Record<string, string> = {};

  constructor(readonly store: HudStore) {}

  connect(url: string): void {
    this.url = url;
    this.closedByUs = false;
    this.store.set({ connection: this.reconnects > 0 ? "reconnecting" : "connecting", error: null });
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnects = 0;
      this.store.set({ connection: "open", error: null });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: "ping", t: performance.now() }), 2000);
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.ws !== ws || this.closedByUs) return;
      const fatal = CLOSE_REASONS[e.code];
      if (fatal || this.store.get().error === "replaced") {
        this.store.set({ connection: "error", error: fatal ?? "This game was opened in another tab." });
        return;
      }
      if (this.reconnects < MAX_RECONNECTS) {
        // Transient drop: retry with backoff. The server keeps our seat and contestant.
        const delay = 500 * 2 ** this.reconnects++;
        this.store.set({ connection: "reconnecting" });
        this.reconnectTimer = setTimeout(() => this.connect(this.url), delay);
      } else {
        this.store.set({ connection: "error", error: "Connection lost." });
      }
    };
  }

  close(): void {
    this.closedByUs = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  onEvent(l: EventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  get running(): boolean {
    return this.snapshot?.status === "running";
  }

  /** True while this player may move: running, exploring, alive, not typing in chat. */
  get canAct(): boolean {
    const s = this.snapshot;
    if (!s || s.status !== "running" || s.phase !== "explore") return false;
    const me = s.roster.find((r) => r.id === this.you);
    return !!me?.alive && !this.store.get().typing;
  }

  say(body: { text: string } | { quick: string }, to: string | null = null): void {
    this.send({ type: "chat", ...body, to });
  }

  vote(target: string | null): void {
    this.send({ type: "vote", target });
  }

  propose(target: string): void {
    this.send({ type: "propose", target });
  }

  respond(proposer: string, accept: boolean): void {
    this.send({ type: "respond", proposer, accept });
  }

  breakAlliance(): void {
    this.send({ type: "break_alliance" });
  }

  name(id: string | null | undefined): string {
    return (id && this.names[id]) || id || "";
  }

  /** One fixed client tick of player intent. Zero input is not sent (it would not move anyway). */
  applyInput(dx: number, dy: number): void {
    const p = this.predictor;
    if (!p) return;
    this.prev = { x: p.x, y: p.y };
    if (!this.canAct || (dx === 0 && dy === 0)) return;
    const input = p.applyLocal(dx, dy);
    this.send({ type: "input", seq: input.seq, dx: input.dx, dy: input.dy });
  }

  interact(targetId: string): void {
    const now = performance.now();
    if (now - this.lastInteract < 200) return;
    this.lastInteract = now;
    this.send({ type: "interact", target_id: targetId });
  }

  contestant(id: string): ContestantDTO | undefined {
    return this.snapshot?.contestants.find((c) => c.id === id);
  }

  private handle(msg: ServerMsg): void {
    switch (msg.type) {
      case "lobby":
        this.store.set({ lobby: msg });
        break;
      case "error":
        if (msg.code === "replaced") {
          this.store.set({ connection: "error", error: "This game was opened in another tab." });
          this.closedByUs = true;
        } else {
          this.toast(msg.message);
        }
        break;
      case "welcome": {
        const isNewMatch = this.store.get().matchId !== msg.match_id;
        this.map = msg.map;
        this.constants = msg.constants;
        this.you = msg.you;
        this.solid = collisionLookup(msg.map.collision, msg.map.width, msg.map.height);
        const me = msg.snapshot.contestants.find((c) => c.id === msg.you)!;
        this.predictor = new Predictor(this.solid, me.x, me.y, msg.resume_seq);
        this.prev = { x: me.x, y: me.y };
        this.correction = { x: 0, y: 0 };
        this.buffers.clear();
        this.snapshot = msg.snapshot;
        this.names = Object.fromEntries(msg.snapshot.roster.map((c) => [c.id, c.name]));
        this.store.set({
          you: msg.you,
          map: msg.map,
          snapshot: msg.snapshot,
          me: { x: me.x, y: me.y },
          matchId: msg.match_id,
          ...(isNewMatch ? { result: null, feed: [], chat: [] } : {}),
        });
        break;
      }
      case "snapshot": {
        this.snapshot = msg;
        const now = performance.now();
        for (const c of msg.contestants) {
          if (c.id === this.you) continue;
          let b = this.buffers.get(c.id);
          if (!b) this.buffers.set(c.id, (b = new InterpolationBuffer()));
          b.push(now, c.x, c.y);
        }
        const me = msg.contestants.find((c) => c.id === this.you);
        if (me && this.predictor) {
          const bx = this.predictor.x;
          const by = this.predictor.y;
          const err = this.predictor.reconcile(msg.ack_seq, me.x, me.y);
          if (err > 0) {
            if (err > 2) {
              this.correction = { x: 0, y: 0 }; // teleport-sized: snap
              this.prev = { x: this.predictor.x, y: this.predictor.y };
            } else {
              this.correction.x += bx - this.predictor.x;
              this.correction.y += by - this.predictor.y;
            }
          }
        }
        for (const ev of msg.events) this.handleEvent(ev);
        // HUD at ~10 Hz is plenty and keeps React work small.
        if (++this.snapshotCount % 2 === 0 || msg.events.length > 0 || msg.status !== "running") {
          this.store.set({ snapshot: msg });
        }
        break;
      }
      case "interact_result":
        if (!msg.ok) this.toast(rejectionText(msg.reason));
        break;
      case "pong":
        this.store.set({ pingMs: Math.round(performance.now() - msg.t) });
        break;
    }
  }

  private handleEvent(ev: GameEventDTO): void {
    if (ev.type === "chat") {
      const d = ev.data as { sender: string; text: string; private: boolean; to: string | null };
      const line = {
        id: ++this.feedId,
        sender: d.sender,
        senderName: this.name(d.sender),
        text: d.text,
        private: d.private,
        to: d.to,
        mine: d.sender === this.you,
      };
      this.store.set((s) => ({ chat: [...s.chat.slice(-40), line] }));
      this.listeners.forEach((l) => l(ev));
      return;
    }
    const line = formatEvent(ev, this.names, this.you);
    if (line) {
      const item = { id: ++this.feedId, ...line };
      this.store.set((s) => ({ feed: [...s.feed.slice(-5), item] }));
    }
    if (ev.type === "match_finished") this.store.set({ result: ev.data as unknown as MatchResult });
    if (ev.type === "vote_resolved") {
      const d = ev.data as { votes: Record<string, string>; eliminated: string | null; skip: number };
      this.store.set({ lastVote: { votes: d.votes, eliminated: d.eliminated, skip: d.skip } });
    }
    this.listeners.forEach((l) => l(ev));
  }

  toast(text: string): void {
    this.store.set({ toast: { id: ++this.toastId, text } });
  }
}
