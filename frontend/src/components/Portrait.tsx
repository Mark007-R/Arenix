"use client";

import { useEffect, useState } from "react";
import { FRAME, FRAME_H, cosmeticKey, type Cosmetics } from "@/game/archetypes";

/** A contestant's 3D figure as a still picture (rendered once per look, then cached). */
export function Portrait({ archetype, scale = 4, className = "", cosmetics }: {
  archetype: string;
  scale?: number;
  className?: string;
  cosmetics?: Cosmetics;
}) {
  const key = cosmeticKey(archetype, cosmetics);
  const width = FRAME * scale;
  const height = FRAME_H * scale;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // Three.js loads only when a portrait is first shown.
    void import("@/game/iso/portrait").then(({ portraitURL }) => {
      if (alive) setSrc(portraitURL(archetype, cosmetics, width, height));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures the cosmetics identity
  }, [key, width, height]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- generated data URL, nothing to optimise
    <img src={src} width={width} height={height} alt="" aria-hidden className={className} />
  ) : (
    <span style={{ display: "inline-block", width, height }} className={className} aria-hidden />
  );
}
