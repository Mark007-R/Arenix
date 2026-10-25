"use client";

import type { ReactNode } from "react";
import { useHud, type HudStore } from "@/lib/store";

export function ResultModal({ store, actions }: { store: HudStore; actions: ReactNode }) {
  const result = useHud(store, (s) => s.result);
  const you = useHud(store, (s) => s.you);
  const rewards = useHud(store, (s) => s.rewards);
  if (!result) return null;
  const winner = result.standings.find((s) => s.id === result.winner);
  const youWon = result.winner === you;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#120c1c]/70 p-4">
      <div className="panel max-h-[90dvh] w-full max-w-2xl overflow-y-auto p-6 text-center" role="dialog" aria-labelledby="result-title">
        <h2 id="result-title" className={`text-3xl font-bold ${youWon ? "text-gold" : "text-leaf"}`}>
          {youWon ? "You won the island!" : `${winner?.name ?? "Nobody"} wins!`}
        </h2>
        <p className="mt-1 text-parchment/80">
          {result.reason === "final_two" ? "Only two contestants remain." : "Time is up."}{" "}
          Watchtower {result.tower_repaired ? "repaired" : "still in ruins"} · Shrine{" "}
          {result.shrine_activated ? "awakened" : "dormant"}
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-gold">
            <tr>
              <th className="py-1">#</th>
              <th>Contestant</th>
              <th>Secret objective</th>
              <th className="text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {result.standings.map((s, i) => (
              <tr key={s.id} className={`${s.id === you ? "text-[#ffe066]" : ""} ${s.alive ? "" : "opacity-60"} align-top`}>
                <td className="py-1">{i + 1}</td>
                <td>
                  {s.name}
                  {s.id === result.winner && " 👑"}
                  {!s.alive && <span className="ml-1 text-xs">(voted out)</span>}
                </td>
                <td className="text-xs">
                  {s.objective ? (
                    <>
                      <span className={s.objective_achieved ? "text-leaf" : "text-parchment/60"}>
                        {s.objective_achieved ? "✔ " : "✘ "}
                      </span>
                      {s.objective.text}
                    </>
                  ) : "—"}
                </td>
                <td className="text-right tabular-nums">
                  {s.score}
                  {Object.keys(s.bonuses).length > 0 && (
                    <div className="text-[10px] text-parchment/50">
                      {Object.entries(s.bonuses).map(([k, v]) => `+${v} ${k}`).join(" ")}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rewards && (
          <div className="mt-4 border-[3px] border-gold bg-[#120c1c] p-3 text-sm" role="status">
            <div className="font-bold text-gold">
              +{rewards.game_points} Game Points · Level {rewards.level}
            </div>
            {rewards.achievements.map((a) => (
              <div key={a.id} className="text-leaf">
                🏆 {a.name} (+{a.game_points} GP{a.diamonds ? `, +${a.diamonds} 💎` : ""})
              </div>
            ))}
            <div className="text-xs text-parchment/60">
              Balance: {rewards.balance.game_points} GP · {rewards.balance.diamonds} 💎
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-center gap-3">{actions}</div>
      </div>
    </div>
  );
}
