"use client";

import type { PointerEvent } from "react";
import type { WorldScene } from "@/game/scenes/WorldScene";
import { useHud, type HudStore } from "@/lib/store";

/** Optional on-screen controls for touch devices. */
export function TouchControls({ store, scene }: { store: HudStore; scene: () => WorldScene | null }) {
  const prompt = useHud(store, (s) => s.prompt);
  const killTarget = useHud(store, (s) => s.killTarget);
  const sheriff = useHud(store, (s) => s.snapshot?.me?.role === "sheriff");
  const set = (dx: number, dy: number) => (e: PointerEvent) => {
    e.preventDefault();
    scene()?.setTouchFromScreen(dx, dy);
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
      <div className="flex flex-col items-end gap-2">
      {killTarget && (
        <button className="pointer-events-auto h-16 w-20 border-[1.5px] border-ink bg-[#9a3029] text-sm font-bold text-parchment"
          onPointerDown={(e) => {
            e.preventDefault();
            const sc = scene();
            if (sc) sc.touch = { ...sc.touch, kill: true };
          }} aria-label={`${sheriff ? "Shoot" : "Eliminate"} ${killTarget.name}`}>
          {sheriff ? "🔫 Shoot" : "🗡️ Kill"}
        </button>
      )}
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
    </div>
  );
}
