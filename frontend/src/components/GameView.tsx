"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JoinParams } from "@/game/net/client";
import type { WorldScene } from "@/game/scenes/WorldScene";
import { createStore, initialHud, useHud } from "@/lib/store";
import { Hud } from "./Hud";
import { ResultModal } from "./ResultModal";
import { TouchControls } from "./TouchControls";
import Link from "next/link";

const MOTION_KEY = "arenix.reducedMotion";

function initialReducedMotion(): boolean {
  try {
    const saved = localStorage.getItem(MOTION_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    /* ignore */
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export default function GameView({ params }: { params: JoinParams }) {
  const store = useMemo(() => createStore(initialHud()), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<() => WorldScene | null>(() => null);
  const [session, setSession] = useState(0);
  const connection = useHud(store, (s) => s.connection);
  const error = useHud(store, (s) => s.error);

  useEffect(() => {
    store.set({ reducedMotion: initialReducedMotion() });
  }, [store]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      // Load the pixel font before Phaser rasterises any text, and Phaser itself lazily.
      await Promise.all([document.fonts.load('8px "Pixelify Sans"').catch(() => undefined)]);
      const [{ GameClient }, { createGame }] = await Promise.all([import("@/game/net/client"), import("@/game/createGame")]);
      if (cancelled) return;
      store.set({ ...initialHud(), reducedMotion: store.get().reducedMotion });
      const client = new GameClient(store);
      client.connect(params);
      const { game, scene } = createGame(host, { client, reducedMotion: () => store.get().reducedMotion });
      sceneRef.current = scene;
      // Debug/e2e handle. Contains only data this client is already allowed to see.
      (window as unknown as { __ARENIX__?: unknown }).__ARENIX__ = { game, client, store };
      // Region label + minimap position at ~5 Hz from the predicted position.
      const timer = setInterval(() => {
        const p = client.predictor;
        if (!p || !client.map) return;
        const region = client.map.regions.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h)?.name ?? null;
        store.set({ me: { x: p.x, y: p.y }, region });
      }, 200);
      cleanup = () => {
        clearInterval(timer);
        client.close();
        game.destroy(true);
        sceneRef.current = () => null;
      };
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [params, session, store]);

  const toggleMotion = useCallback(() => {
    const next = !store.get().reducedMotion;
    store.set({ reducedMotion: next });
    try {
      localStorage.setItem(MOTION_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [store]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#2f68b8]">
      <div ref={hostRef} className="absolute inset-0" />
      <Hud store={store} onToggleMotion={toggleMotion} />
      <TouchControls store={store} scene={() => sceneRef.current()} />
      <ResultModal store={store} onReplay={() => setSession((n) => n + 1)} />
      {(connection === "connecting" || connection === "idle") && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/80">
          <div className="panel px-6 py-4 text-lg">Sailing to Emerald Isle…</div>
        </div>
      )}
      {connection === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/80 p-4">
          <div className="panel max-w-md p-6 text-center">
            <h2 className="text-2xl font-bold text-ember">Connection problem</h2>
            <p className="mt-2 text-parchment/85">{error}</p>
            <p className="mt-2 text-xs text-parchment/50">
              Is the game server running? <code>cd backend &amp;&amp; uv run uvicorn arenix.server.app:app</code>
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button className="btn" onClick={() => setSession((n) => n + 1)}>Retry</button>
              <Link className="btn btn-ghost" href="/">Main menu</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
