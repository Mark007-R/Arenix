"use client";

import { useEffect, useMemo, useRef } from "react";
import { MINIMAP_COLORS } from "@/game/art/tiles";
import type { HudStore } from "@/lib/store";
import { useHud } from "@/lib/store";

const SCALE = 2;

/** Full-map overview. Milestone 1 rule: every contestant is visible (no fog of war yet). */
export function Minimap({ store }: { store: HudStore }) {
  const map = useHud(store, (s) => s.map);
  const snapshot = useHud(store, (s) => s.snapshot);
  const me = useHud(store, (s) => s.me);
  const you = useHud(store, (s) => s.you);
  const ref = useRef<HTMLCanvasElement>(null);

  const base = useMemo(() => {
    if (!map || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = map.width * SCALE;
    c.height = map.height * SCALE;
    const ctx = c.getContext("2d")!;
    map.tiles.forEach((t, i) => {
      ctx.fillStyle = MINIMAP_COLORS[t] ?? "#000";
      ctx.fillRect((i % map.width) * SCALE, Math.floor(i / map.width) * SCALE, SCALE, SCALE);
    });
    for (const o of map.objects) {
      if (o.kind === "house") {
        ctx.fillStyle = "#c8483c";
        ctx.fillRect(o.x * SCALE, o.y * SCALE, o.w * SCALE, o.h * SCALE);
      }
    }
    return c;
  }, [map]);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !base || !map || !snapshot) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0);
    for (const o of map.objects) {
      if (o.kind !== "resource_node") continue;
      const left = snapshot.nodes[o.id] ?? 0;
      ctx.fillStyle = left > 0 ? (o.props.resource === "wood" ? "#c58d55" : "#e5e8ee") : "#4b3a6b";
      ctx.fillRect(o.x * SCALE, o.y * SCALE, SCALE, SCALE);
    }
    const tower = map.objects.find((o) => o.id === snapshot.mission.target_id);
    if (tower) {
      ctx.fillStyle = snapshot.mission.status === "completed" ? "#86d35f" : "#f4c542";
      ctx.fillRect(tower.x * SCALE - 1, tower.y * SCALE - 1, tower.w * SCALE + 2, tower.h * SCALE + 2);
    }
    for (const c of snapshot.contestants) {
      const pos = c.id === you && me ? me : c;
      ctx.fillStyle = "#1f1630";
      ctx.fillRect(pos.x * SCALE - 2, pos.y * SCALE - 2, 4, 4);
      ctx.fillStyle = c.id === you ? "#ffe066" : "#d6453b";
      ctx.fillRect(pos.x * SCALE - 1, pos.y * SCALE - 1, 2, 2);
    }
  }, [base, map, snapshot, me, you]);

  if (!map) return null;
  return (
    <div className="panel p-1">
      <canvas ref={ref} width={map.width * SCALE} height={map.height * SCALE}
        className="block h-auto w-[192px]" aria-label="Minimap" />
    </div>
  );
}
