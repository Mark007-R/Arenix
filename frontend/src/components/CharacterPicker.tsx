"use client";

import type { CSSProperties } from "react";
import { ARCHETYPES } from "@/game/archetypes";
import { OUTFITS } from "@/game/iso/palette3d";
import { Portrait } from "./Portrait";

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

export function CharacterPicker({ value, onChange, compact = false }: {
  value: string;
  onChange: (a: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Character">
      {ARCHETYPE_KEYS.map((k) => {
        const vest = OUTFITS[k]?.vest ?? "#e4572e";
        const picked = k === value;
        // Each card is tinted with its contestant's colour; the picked one gets a ring and a check.
        const style = {
          background: `color-mix(in srgb, ${vest} ${picked ? 26 : 12}%, var(--color-well))`,
          "--pick-ring": vest,
        } as CSSProperties;
        return (
          <button
            key={k}
            role="radio"
            aria-checked={picked}
            onClick={() => onChange(k)}
            style={style}
            className="pick-card flex flex-col items-center border-[1.5px] border-ink p-1 pt-2"
          >
            {picked && <span className="pick-check" aria-hidden>✓</span>}
            <Portrait archetype={k} scale={compact ? 2 : 3} />
            <span className={`mt-1 leading-tight ${picked ? "font-bold" : ""} ${compact ? "text-[10px]" : "text-xs"}`}>
              {ARCHETYPES[k]!.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
