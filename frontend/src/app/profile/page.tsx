"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError } from "@/lib/account";
import { getProfile, MAP_NAMES, percent, ROLE_NAMES, type PublicProfile } from "@/lib/social";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-[3px] border-ink bg-[#120c1c] p-3 text-center">
      <div className="text-2xl font-bold text-gold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider text-parchment/60">{label}</div>
    </div>
  );
}

function Profile() {
  const id = Number(useSearchParams().get("id"));
  const [p, setP] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let alive = true;
    getProfile(id)
      .then((d) => alive && setP(d))
      .catch((e) => alive && setError(e instanceof ApiError && e.status === 404 ? "No such player." : "Could not load this profile."));
    return () => {
      alive = false;
    };
  }, [id]);

  const bad = !Number.isInteger(id) || id <= 0;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-3xl font-bold text-gold">{p ? p.display_name : "Player"}</h1>
        <div className="flex gap-2">
          <Link href="/leaderboard" className="btn btn-ghost">Leaderboard</Link>
          <Link href="/" className="btn btn-ghost">Menu</Link>
        </div>
      </div>
      {bad || error ? (
        <p className="panel p-4 text-ember">{bad ? "No such player." : error}</p>
      ) : !p ? (
        <p className="panel p-4 text-parchment/60">Loading…</p>
      ) : (
        <div className="space-y-4">
          <section className="panel pop-in p-5">
            <p className="mb-3 text-sm text-parchment/70">Level {p.level} · joined {p.joined}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Matches" value={p.matches_played} />
              <Stat label="Wins" value={p.wins} />
              <Stat label="Win rate" value={percent(p.win_rate)} />
              <Stat label="Delivered" value={p.units_delivered} />
            </div>
          </section>
          <section className="panel p-5">
            <h2 className="mb-2 font-bold text-gold">Achievements ({p.achievements.length})</h2>
            {p.achievements.length === 0 ? (
              <p className="text-sm text-parchment/60">None yet.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {p.achievements.map((a) => (
                  <li key={a.id} className="border-[3px] border-ink bg-[#120c1c] p-2 text-sm">
                    <span className="text-gold">🏆 {a.name}</span>
                    <span className="block text-xs text-parchment/70">{a.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel p-5">
            <h2 className="mb-2 font-bold text-gold">Recent matches</h2>
            {p.recent_matches.length === 0 ? (
              <p className="text-sm text-parchment/60">No matches yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <tbody>
                  {p.recent_matches.map((m) => (
                    <tr key={m.finished_at} className="border-b-2 border-dusk/50 last:border-0">
                      <td className={`py-1 font-bold ${m.won ? "text-leaf" : "text-ember"}`}>{m.won ? "Win" : "Loss"}</td>
                      <td>{MAP_NAMES[m.map_id] ?? m.map_id}</td>
                      <td>{m.role ? ROLE_NAMES[m.role] ?? m.role : "—"}</td>
                      <td className="text-right tabular-nums">{m.score} pts</td>
                      <td className="text-right text-xs text-parchment/60">{new Date(m.finished_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <main className="sky min-h-dvh px-4 py-8">
      <Suspense fallback={null}>
        <Profile />
      </Suspense>
    </main>
  );
}
