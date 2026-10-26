"use client";

import { useState } from "react";
import type { GameClient } from "@/game/net/client";
import { useHud, type HudStore } from "@/lib/store";

export const REPORT_REASONS: [string, string][] = [
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate speech"],
  ["cheating", "Cheating"],
  ["spam", "Spam"],
  ["inappropriate_name", "Inappropriate name"],
  ["other", "Something else"],
];

/** Mute / report controls for one contestant. Muting is local; reports go to the moderators. */
export function SafetyMenu({ client, store, id, onDone }: { client: GameClient; store: HudStore; id: string; onDone?: () => void }) {
  const muted = useHud(store, (s) => s.muted.includes(id));
  const isBot = useHud(store, (s) => s.snapshot?.roster.find((r) => r.id === id)?.is_bot ?? false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  if (reporting) {
    return (
      <div className="my-1 space-y-1 border-2 border-ink bg-[#120c1c] p-2 text-xs">
        <div className="text-gold">Report {client.name(id)}{isBot ? " (AI)" : ""} for…</div>
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional details"
          onKeyDown={(e) => e.stopPropagation()}
          onFocus={() => store.set({ typing: true })} onBlur={() => store.set({ typing: false })}
          className="w-full border-2 border-ink bg-[#1f1630] px-1 py-0.5 outline-none focus:border-sky" />
        <div className="grid grid-cols-2 gap-1">
          {REPORT_REASONS.map(([reason, label]) => (
            <button key={reason} className="border-2 border-ink bg-[#1f1630] px-1 py-0.5 text-left hover:border-gold"
              onClick={() => { client.report(id, reason, note || null); setReporting(false); onDone?.(); }}>
              {label}
            </button>
          ))}
        </div>
        <button className="underline" onClick={() => setReporting(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <>
      <button className="btn btn-ghost px-2 py-0.5 text-xs" title={muted ? "Show their messages again" : "Hide their messages from you"}
        onClick={() => {
          store.set((s) => ({ muted: muted ? s.muted.filter((m) => m !== id) : [...s.muted, id] }));
          onDone?.();
        }}>
        {muted ? "🔊 Unmute" : "🔇 Mute"}
      </button>
      <button className="btn btn-ghost px-2 py-0.5 text-xs" title="Report to the moderators" onClick={() => setReporting(true)}>
        🚩 Report
      </button>
    </>
  );
}
