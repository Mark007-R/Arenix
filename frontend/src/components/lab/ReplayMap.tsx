"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "@/game/net/client";
import { minimapColors } from "@/game/art/tiles";
import type { MapDTO } from "@/shared/protocol";

const S = 4;

export function ReplayMap({ mapId, positions, highlight }: { mapId: string; positions: Record<string, number[]>; highlight: string | null }) {
  const [map, setMap] = useState<MapDTO | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    fetch(`${apiUrl()}/api/maps/${mapId}`).then((r) => r.json()).then(setMap).catch(() => undefined);
  }, [mapId]);
  const base = useMemo(() => {
    if (!map || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = map.width * S;
    c.height = map.height * S;
    const ctx = c.getContext("2d")!;
    const colors = minimapColors(map.theme);
    map.tiles.forEach((t, i) => {
      ctx.fillStyle = colors[t] ?? "#000";
      ctx.fillRect((i % map.width) * S, Math.floor(i / map.width) * S, S, S);
    });
    return c;
  }, [map]);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !base) return;
    ctx.drawImage(base, 0, 0);
    ctx.font = "10px monospace";
    for (const [id, [x, y]] of Object.entries(positions)) {
      ctx.fillStyle = "#1f1630";
      ctx.fillRect(x! * S - 4, y! * S - 4, 8, 8);
      ctx.fillStyle = id === highlight ? "#ffe066" : id.startsWith("bot") ? "#6aa8ee" : "#d6453b";
      ctx.fillRect(x! * S - 3, y! * S - 3, 6, 6);
      ctx.fillStyle = "#fbf7ee";
      ctx.fillText(id, x! * S + 5, y! * S - 4);
    }
  }, [base, positions, highlight]);
  if (!map) return <div className="text-sm text-parchment/60">Loading map…</div>;
  return <canvas ref={ref} width={map.width * S} height={map.height * S} className="block h-auto w-full border-[3px] border-ink" aria-label="Replay map" />;
}
