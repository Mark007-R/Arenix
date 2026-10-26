import { useSyncExternalStore } from "react";
import type { LobbyMsg, MapDTO, MatchResult, RewardsMsg, SnapshotDTO } from "@/shared/protocol";

export interface FeedItem {
  id: number;
  text: string;
  tone: "info" | "good" | "bad" | "mine";
}

export interface ChatLine {
  id: number;
  sender: string;
  senderName: string;
  text: string;
  private: boolean;
  to: string | null;
  mine: boolean;
  /** Structured agent-protocol message type (PLAN_PROPOSAL, ACCEPT, …), null for plain chat. */
  kind: string | null;
  /** Sent by a ghost; only other ghosts see it. */
  ghost: boolean;
  /** Match tick and meeting number when it was said (to group meeting chat). */
  tick: number;
  meeting: number;
}

export interface VoteReveal {
  votes: Record<string, string>;
  eliminated: string | null;
  skip: number;
  /** Impostor mode: ejections are confirmed. */
  was_impostor?: boolean;
  impostors_left?: number;
}

export interface HudState {
  connection: "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";
  error: string | null;
  lobby: LobbyMsg | null;
  /** Id of the match the latest welcome belongs to; changes when a new match starts. */
  matchId: string | null;
  you: string | null;
  map: MapDTO | null;
  snapshot: SnapshotDTO | null;
  /** Locally predicted position of the player for the minimap/region label. */
  me: { x: number; y: number } | null;
  region: string | null;
  feed: FeedItem[];
  chat: ChatLine[];
  /** Chat input focused: the game must ignore movement keys. */
  typing: boolean;
  prompt: { targetId: string; label: string } | null;
  /** Contestants whose chat this player has muted (local only). */
  muted: string[];
  /** Impostor mode: the islander currently in kill range (if the knife is ready). */
  killTarget: { id: string; name: string } | null;
  toast: { id: number; text: string } | null;
  result: MatchResult | null;
  lastVote: VoteReveal | null;
  /** Why the current meeting was called (impostor mode shows the body report). */
  meetingCause: { cause: string; caller: string | null; victim?: string; region?: string } | null;
  /** Impostor mode: role + skill splash shown at the start of a match. */
  intro: number | null;
  rewards: RewardsMsg | null;
  pingMs: number | null;
  reducedMotion: boolean;
}

type Listener = () => void;

export function createStore<S>(initial: S) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<S> | ((s: S) => Partial<S>)) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const initialHud = (): HudState => ({
  connection: "idle",
  error: null,
  lobby: null,
  matchId: null,
  you: null,
  map: null,
  snapshot: null,
  me: null,
  region: null,
  feed: [],
  chat: [],
  typing: false,
  prompt: null,
  killTarget: null,
  muted: [],
  toast: null,
  result: null,
  lastVote: null,
  meetingCause: null,
  intro: null,
  rewards: null,
  pingMs: null,
  reducedMotion: false,
});

export type HudStore = ReturnType<typeof createStore<HudState>>;

export function useHud<T>(store: HudStore, selector: (s: HudState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
