"use client";

import { useEffect, useRef } from "react";
import { FRAME, FRAME_H, buildPortrait } from "@/game/art/characters";

export function Portrait({ archetype, scale = 4, className = "" }: { archetype: string; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buildPortrait(archetype, scale), 0, 0);
  }, [archetype, scale]);
  return <canvas ref={ref} width={FRAME * scale} height={FRAME_H * scale} className={className} aria-hidden />;
}
