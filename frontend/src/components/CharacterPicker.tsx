"use client";

import { ARCHETYPES } from "@/game/archetypes";
import { Portrait } from "./Portrait";

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

export function CharacterPicker({ value, onChange, compact = false }: {
  value: string;
  onChange: (a: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Character">
      {ARCHETYPE_KEYS.map((k) => (
        <button
          key={k}
          role="radio"
          aria-checked={k === value}
          onClick={() => onChange(k)}
          className={`flex flex-col items-center border-[1.5px] p-1 pt-2 ${
            k === value ? "border-gold bg-dusk" : "border-ink bg-well hover:border-dusk"
          }`}
        >
          <Portrait archetype={k} scale={compact ? 2 : 3} />
          <span className={`mt-1 leading-tight ${compact ? "text-[10px]" : "text-xs"}`}>{ARCHETYPES[k]!.label}</span>
        </button>
      ))}
    </div>
  );
}
