"use client";

import { useEffect } from "react";
import { audio } from "@/lib/audio";
import { adBreak, gameplayStart, gameplayStop, onPortal } from "@/lib/portal";
import type { HudStore } from "@/lib/store";

/** Reports gameplay start/stop to a game portal and plays its ad break when a match ends. */
export function PortalBridge({ store }: { store: HudStore }) {
  useEffect(() => {
    if (!onPortal()) return;
    let wasRunning = false;
    const unsub = store.subscribe(() => {
      const s = store.get();
      const running = s.snapshot?.status === "running" && !s.result;
      if (running && !wasRunning) gameplayStart();
      if (!running && wasRunning) {
        gameplayStop();
        // Between matches: the results screen is a natural break. Silence the game while the ad plays.
        audio().silence(true);
        void adBreak().then(() => audio().silence(false));
      }
      wasRunning = running;
    });
    return () => {
      unsub();
      gameplayStop();
    };
  }, [store]);
  return null;
}
