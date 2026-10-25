"use client";

import type { PointerEvent } from "react";
import type { WorldScene } from "@/game/scenes/WorldScene";
import { useHud, type HudStore } from "@/lib/store";

/** Optional on-screen controls for touch devices. */
export function TouchControls({ store, scene }: { store: HudStore; scene: () => WorldScene | null }) {
  const prompt = useHud(store, (s) => s.prompt);
  const set = (dx: number, dy: number) => (e: PointerEvent) => {
    e.preventDefault();
    const s = scene();
    if (s) s.touch = { ...s.touch, dx, dy };
  };
  const pad = "pointer-events-auto flex h-14 w-14 items-center justify-center panel text-xl active:bg-dusk";
  return (
    <div className="absolute inset-x-0 bottom-20 flex items-end justify-between px-4 sm:hidden">
      <div className="grid grid-cols-3 gap-1">
        <span />
        <button className={pad} onPointerDown={set(0, -1)} onPointerUp={set(0, 0)} onPointerLeave={set(0, 0)} aria-label="Up">▲</button>
        <span />
        <button className={pad} onPointerDown={set(-1, 0)} onPointerUp={set(0, 0)} onPointerLeave={set(0, 0)} aria-label="Left">◀</button>
        <span />
        <button className={pad} onPointerDown={set(1, 0)} onPointerUp={set(0, 0)} onPointerLeave={set(0, 0)} aria-label="Right">▶</button>
        <span />
        <button className={pad} onPointerDown={set(0, 1)} onPointerUp={set(0, 0)} onPointerLeave={set(0, 0)} aria-label="Down">▼</button>
        <span />
      </div>
      <button
        className="btn pointer-events-auto h-20 w-20 rounded-none text-sm"
        disabled={!prompt}
        style={prompt ? undefined : { opacity: 0.4 }}
        onPointerDown={(e) => {
          e.preventDefault();
          const s = scene();
          if (s) s.touch = { ...s.touch, interact: true };
        }}
      >
        {prompt ? prompt.label.split(" ")[0] : "Use"}
      </button>
    </div>
  );
}
