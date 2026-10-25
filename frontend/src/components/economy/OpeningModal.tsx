"use client";

import { useEffect, useState } from "react";
import { Portrait } from "../Portrait";
import { RARITY_COLOR, previewCosmetics, type ItemDTO } from "./types";

export interface OpeningResult {
  item: ItemDTO;
  duplicate: boolean;
  refund_points: number;
  crate_id: string;
}

/** Short, skippable crate reveal. Reduced motion shows the result immediately. */
export function OpeningModal({ result, crateName, reducedMotion, onEquip, onClose }: {
  result: OpeningResult;
  crateName: string;
  reducedMotion: boolean;
  onEquip: (() => void) | null;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(reducedMotion);
  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setRevealed(true), 1100);
    return () => clearTimeout(t);
  }, [revealed]);
  const color = RARITY_COLOR[result.item.rarity];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" role="dialog" aria-label="Crate opening"
      onClick={() => setRevealed(true)}>
      <div className="panel w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
        {!revealed ? (
          <>
            <div className="mx-auto mb-4 h-24 w-24 animate-[crate-shake_0.35s_ease-in-out_infinite] border-[4px] border-ink bg-[#8a5a32] shadow-[inset_-6px_-6px_0_#6b4026,inset_6px_6px_0_#c58d55]">
              <div className="mx-auto mt-9 h-3 w-full bg-gold" />
            </div>
            <p className="text-parchment/80">Opening {crateName}…</p>
            <button className="btn btn-ghost mt-4 text-sm" onClick={() => setRevealed(true)}>Skip</button>
          </>
        ) : (
          <>
            <div className="text-xs uppercase tracking-widest" style={{ color }}>{result.item.rarity}</div>
            <div className="my-3 flex justify-center">
              {result.item.kind === "skin" || result.item.kind === "hat" ? (
                <Portrait archetype="knight" scale={6} cosmetics={previewCosmetics(result.item)} />
              ) : (
                <div className="flex h-28 w-24 items-center justify-center text-5xl">{result.item.kind === "chat_pack" ? "💬" : "✨"}</div>
              )}
            </div>
            <h2 className="text-2xl font-bold" style={{ color }}>{result.item.name}</h2>
            <p className="text-sm capitalize text-parchment/70">{result.item.kind.replace("_", " ")}</p>
            {result.duplicate && (
              <p className="mt-2 text-sm text-gold">Duplicate! Converted into +{result.refund_points} Game Points.</p>
            )}
            <div className="mt-5 flex justify-center gap-3">
              {onEquip && !result.duplicate && <button className="btn" onClick={onEquip}>Equip</button>}
              <button className="btn btn-ghost" onClick={onClose} autoFocus>Back to crates</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
