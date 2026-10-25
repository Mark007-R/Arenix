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

export function serverUrl(): string {
  const env = process.env.NEXT_PUBLIC_ARENIX_WS;
  if (env) return env;
  if (typeof window === "undefined") return "ws://localhost:8000";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:8000`;
}

type EventListener = (ev: GameEventDTO) => void;

export class GameClient {
  map: MapDTO | null = null;
  constants: Constants | null = null;
  you: string | null = null;
  solid: SolidFn = () => true;
  predictor: Predictor | null = null;
  snapshot: SnapshotDTO | null = null;
  /** Position before and after the most recent local prediction step (for render smoothing). */
  prev = { x: 0, y: 0 };
  /** Visual offset left over from a reconciliation snap; decays to zero. */
  correction = { x: 0, y: 0 };
  readonly buffers = new Map<string, InterpolationBuffer>();
  private ws: WebSocket | null = null;
  private feedId = 0;
  private toastId = 0;
  private lastInteract = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotCount = 0;
  private listeners = new Set<EventListener>();
  private names: Record<string, string> = {};

  constructor(readonly store: HudStore) {}

  connect(params: JoinParams): void {
    this.store.set({ connection: "connecting", error: null, result: null, feed: [] });
    const q = new URLSearchParams({ name: params.name, archetype: params.archetype, bots: String(params.bots) });
    const ws = new WebSocket(`${serverUrl()}/ws/practice?${q}`);
    this.ws = ws;
    ws.onopen = () => {
      this.store.set({ connection: "open" });
      this.pingTimer = setInterval(() => this.send({ type: "ping", t: performance.now() }), 2000);
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string) as ServerMsg);
    ws.onerror = () => this.store.set({ connection: "error", error: "Could not reach the ARENIX server." });
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      const s = this.store.get();
      if (s.result) {
        this.store.set({ connection: "closed" });
      } else {
        this.store.set({
          connection: "error",
          error: e.code === 4400 ? "The server rejected your name or character." : (s.error ?? "Connection lost."),
        });
      }
    };
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  onEvent(l: EventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  get running(): boolean {
    return this.snapshot?.status === "running";
  }

  /** One fixed client tick of player intent. Zero input is not sent (it would not move anyway). */
  applyInput(dx: number, dy: number): void {
    const p = this.predictor;
    if (!p || !this.running) return;
    this.prev = { x: p.x, y: p.y };
    if (dx === 0 && dy === 0) return;
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
      case "welcome": {
        this.map = msg.map;
        this.constants = msg.constants;
        this.you = msg.you;
        this.solid = collisionLookup(msg.map.collision, msg.map.width, msg.map.height);
        const me = msg.snapshot.contestants.find((c) => c.id === msg.you)!;
        this.predictor = new Predictor(this.solid, me.x, me.y);
        this.prev = { x: me.x, y: me.y };
        this.snapshot = msg.snapshot;
        this.names = Object.fromEntries(msg.snapshot.contestants.map((c) => [c.id, c.name]));
        this.store.set({ you: msg.you, map: msg.map, snapshot: msg.snapshot, me: { x: me.x, y: me.y } });
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
    const line = formatEvent(ev, this.names, this.you);
    if (line) {
      const item = { id: ++this.feedId, ...line };
      this.store.set((s) => ({ feed: [...s.feed.slice(-5), item] }));
    }
    if (ev.type === "match_finished") this.store.set({ result: ev.data as unknown as MatchResult });
    this.listeners.forEach((l) => l(ev));
  }

  toast(text: string): void {
    this.store.set({ toast: { id: ++this.toastId, text } });
  }
}
