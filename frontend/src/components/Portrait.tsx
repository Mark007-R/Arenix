"use client";

import { useEffect, useRef } from "react";
import { FRAME, FRAME_H, buildPortrait, cosmeticKey, type Cosmetics } from "@/game/art/characters";

export function Portrait({ archetype, scale = 4, className = "", cosmetics }: {
  archetype: string;
  scale?: number;
  className?: string;
  cosmetics?: Cosmetics;
}) {
  const key = cosmeticKey(archetype, cosmetics);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buildPortrait(archetype, scale, cosmetics), 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures the cosmetics identity
  }, [key, scale]);
  return <canvas ref={ref} width={FRAME * scale} height={FRAME_H * scale} className={className} aria-hidden />;
}
