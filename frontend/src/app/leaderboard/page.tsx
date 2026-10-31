"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/account";
import { getLeaderboard, percent, type Board, type Leaderboard } from "@/lib/social";

const BOARDS: { id: Board; label: string }[] = [
  { id: "wins", label: "🏆 Wins" },
  { id: "level", label: "⭐ Level" },
  { id: "win_rate", label: "📈 Win rate" },
];

const MEDAL = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const [by, setBy] = useState<Board>("wins");
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getLeaderboard(by)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Could not load the leaderboard."));
    return () => {
      alive = false;
    };
  }, [by]);

  return (
    <main className="sky min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gold">Leaderboard</h1>
          <Link href="/" className="btn btn-ghost">Menu</Link>
        </div>
        <div className="mb-3 flex gap-2" role="tablist" aria-label="Ranking">
          {BOARDS.map((b) => (
            <button key={b.id} role="tab" aria-selected={by === b.id}
              className={`btn flex-1 text-sm ${by === b.id ? "" : "btn-ghost"}`} onClick={() => setBy(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
        <section className="panel p-4">
          {error ? (
            <p className="text-ember">{error}</p>
          ) : !data ? (
            <p className="text-parchment/60">Loading…</p>
          ) : data.entries.length === 0 ? (
            <p className="text-parchment/70">
              No ranked players yet{by === "win_rate" ? ` (win rate needs ${data.min_matches}+ matches)` : ""}. Create an account and play a match to
              be the first!
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-gold">
                <tr>
                  <th className="py-1 pr-2">#</th>
                  <th>Player</th>
                  <th className="text-right">Level</th>
                  <th className="text-right">Wins</th>
                  <th className="text-right">Played</th>
                  <th className="text-right">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.user_id} className={`pop-in ${e.rank <= 3 ? "text-[#a3591c]" : ""}`}>
                    <td className="py-1 pr-2 tabular-nums">{MEDAL[e.rank - 1] ?? e.rank}</td>
                    <td><Link className="underline-offset-2 hover:underline" href={`/profile?id=${e.user_id}`}>{e.display_name}</Link></td>
                    <td className="text-right tabular-nums">{e.level}</td>
                    <td className="text-right tabular-nums">{e.wins}</td>
                    <td className="text-right tabular-nums">{e.matches_played}</td>
                    <td className="text-right tabular-nums">{percent(e.win_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-parchment/50">Only registered accounts are ranked. Guests stay private.</p>
        </section>
      </div>
    </main>
  );
}
