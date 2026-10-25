"use client";

import { useCallback, useEffect, useRef } from "react";
import type { GameClient } from "@/game/net/client";
import type { WorldScene } from "@/game/scenes/WorldScene";
import { saveReducedMotion } from "@/lib/useGameClient";
import type { HudStore } from "@/lib/store";
import { Hud } from "./Hud";
import { TouchControls } from "./TouchControls";

/** Mounts the Phaser world + HUD for the client's current match. Unmount destroys the game. */
export function GameStage({ client, store }: { client: GameClient; store: HudStore }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<() => WorldScene | null>(() => null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      // Load the pixel font before Phaser rasterises any text, and Phaser itself lazily.
      await document.fonts.load('8px "Pixelify Sans"').catch(() => undefined);
      const { createGame } = await import("@/game/createGame");
      if (cancelled) return;
      const { game, scene } = createGame(host, { client, reducedMotion: () => store.get().reducedMotion });
      sceneRef.current = scene;
      const w = window as unknown as { __ARENIX__?: Record<string, unknown> };
      if (w.__ARENIX__) w.__ARENIX__.game = game;
      // Region label + minimap position at ~5 Hz from the predicted position.
      const timer = setInterval(() => {
        const p = client.predictor;
        if (!p || !client.map) return;
        const region =
          client.map.regions.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h)?.name ?? null;
        store.set({ me: { x: p.x, y: p.y }, region });
      }, 200);
      cleanup = () => {
        clearInterval(timer);
        game.destroy(true);
        sceneRef.current = () => null;
      };
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [client, store]);

  const toggleMotion = useCallback(() => {
    const next = !store.get().reducedMotion;
    store.set({ reducedMotion: next });
    saveReducedMotion(next);
  }, [store]);

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" />
      <Hud store={store} onToggleMotion={toggleMotion} />
      <TouchControls store={store} scene={() => sceneRef.current()} />
    </div>
  );
}
