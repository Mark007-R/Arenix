"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameClient } from "@/game/net/client";
import { createStore, initialHud, type HudStore } from "./store";

const MOTION_KEY = "arenix.reducedMotion";

export function loadReducedMotion(): boolean {
  try {
    const saved = localStorage.getItem(MOTION_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function saveReducedMotion(on: boolean): void {
  try {
    localStorage.setItem(MOTION_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/**
 * Creates a store + GameClient connected to `url` for the lifetime of the component (or until
 * `url`/`session` changes). The client module is loaded lazily so it never runs during SSR.
 */
export function useGameClient(url: string | null, session = 0): { store: HudStore; client: GameClient | null } {
  const store = useMemo(() => createStore(initialHud()), []);
  const [client, setClient] = useState<GameClient | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let instance: GameClient | null = null;
    store.set({ ...initialHud(), reducedMotion: loadReducedMotion() });
    import("@/game/net/client").then(({ GameClient }) => {
      if (cancelled) return;
      instance = new GameClient(store);
      instance.connect(url);
      setClient(instance);
      // Debug/e2e handle. Contains only data this client is already allowed to see.
      (window as unknown as { __ARENIX__?: unknown }).__ARENIX__ = { client: instance, store };
    });
    return () => {
      cancelled = true;
      instance?.close();
      setClient(null);
    };
  }, [url, session, store]);

  return { store, client };
}
