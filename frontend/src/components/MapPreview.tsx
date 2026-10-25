"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/game/net/client";
import { MINIMAP_COLORS } from "@/game/art/tiles";
import type { MapDTO } from "@/shared/protocol";

/** Small static render of a map for the lobby. */
export function MapPreview({ mapId }: { mapId: string }) {
  const [map, setMap] = useState<MapDTO | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${apiUrl()}/api/maps/${mapId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => alive && setMap(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mapId]);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !map) return;
    map.tiles.forEach((t, i) => {
      ctx.fillStyle = MINIMAP_COLORS[t] ?? "#000";
      ctx.fillRect((i % map.width) * 3, Math.floor(i / map.width) * 3, 3, 3);
    });
    for (const o of map.objects) {
      ctx.fillStyle = o.kind === "house" ? "#c8483c" : o.id === "watchtower" ? "#f4c542" : o.kind === "resource_node" ? (o.props.resource === "wood" ? "#c58d55" : "#e5e8ee") : "#6e7482";
      ctx.fillRect(o.x * 3, o.y * 3, o.w * 3, o.h * 3);
    }
  }, [map]);
  return (
    <div className="border-[3px] border-ink bg-[#2f68b8]">
      {map ? (
        <canvas ref={ref} width={map.width * 3} height={map.height * 3} className="block h-auto w-full" aria-label={`${map.name} map preview`} />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center text-sm text-parchment/60">Loading map…</div>
      )}
    </div>
  );
}
