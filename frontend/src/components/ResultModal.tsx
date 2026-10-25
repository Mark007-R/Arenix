"use client";

import Link from "next/link";
import { useHud, type HudStore } from "@/lib/store";

export function ResultModal({ store, onReplay }: { store: HudStore; onReplay: () => void }) {
  const result = useHud(store, (s) => s.result);
  const you = useHud(store, (s) => s.you);
  if (!result) return null;
  const won = result.reason === "mission_completed";
  const mvp = result.standings.find((s) => s.id === result.winner);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#120c1c]/60 p-4">
      <div className="panel w-full max-w-md p-6 text-center" role="dialog" aria-labelledby="result-title">
        <h2 id="result-title" className={`text-3xl font-bold ${won ? "text-leaf" : "text-ember"}`}>
          {won ? "Watchtower Repaired!" : "Time's Up!"}
        </h2>
        <p className="mt-1 text-parchment/80">
          {won ? (mvp?.id === you ? "You are the MVP. The island will remember this." : `${mvp?.name} is the MVP.`)
            : "The tower crumbles a little more. Nobody wins today."}
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-gold">
            <tr><th className="py-1">#</th><th>Contestant</th><th className="text-right">Delivered</th><th className="text-right">Score</th></tr>
          </thead>
          <tbody>
            {result.standings.map((s, i) => (
              <tr key={s.id} className={s.id === you ? "text-[#ffe066]" : ""}>
                <td className="py-0.5">{i + 1}</td>
                <td>{s.name}{s.id === result.winner && " 👑"}</td>
                <td className="text-right tabular-nums">{s.contributed}</td>
                <td className="text-right tabular-nums">{s.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn" onClick={onReplay} autoFocus>Play again</button>
          <Link className="btn btn-ghost" href="/">Main menu</Link>
        </div>
      </div>
    </div>
  );
}
