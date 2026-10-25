import { useSyncExternalStore } from "react";
import type { LobbyMsg, MapDTO, MatchResult, SnapshotDTO } from "@/shared/protocol";

export interface FeedItem {
  id: number;
  text: string;
  tone: "info" | "good" | "bad" | "mine";
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
  prompt: { targetId: string; label: string } | null;
  toast: { id: number; text: string } | null;
  result: MatchResult | null;
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
  prompt: null,
  toast: null,
  result: null,
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
