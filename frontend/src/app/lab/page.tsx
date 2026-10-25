"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiUrl } from "@/game/net/client";

interface MatchItem { id: string; room_code: string | null; status: string; ticks: number; source: string; ai_mode: string; contestants: number }

export default function LabIndex() {
  const [matches, setMatches] = useState<MatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${apiUrl()}/api/agent-lab/matches`).then((r) => r.json()).then((d) => setMatches(d.matches))
      .catch(() => setError("Could not reach the ARENIX server."));
  }, []);
  return (
    <main className="min-h-dvh px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gold">Agent Lab</h1>
            <p className="text-sm text-parchment/70">How AI contestants cooperate, negotiate and betray — from the authoritative event log.</p>
          </div>
          <div className="flex gap-2">
            <Link className="btn btn-ghost" href="/lab/experiments">Experiments</Link>
            <Link className="btn btn-ghost" href="/">Menu</Link>
          </div>
        </header>
        {error && <p className="panel p-3 text-ember">{error}</p>}
        {matches && matches.length === 0 && <p className="panel p-4">No matches yet. Play one — it appears here live, and in full once it ends.</p>}
        <ul className="space-y-2">
          {matches?.map((m) => (
            <li key={m.id}>
              <Link href={`/lab/${encodeURIComponent(m.id)}`} className="panel flex items-center justify-between p-3 hover:border-gold">
                <span className="font-bold">{m.id}</span>
                <span className="text-sm text-parchment/70">
                  {m.contestants} contestants · AI: {m.ai_mode} · {Math.round(m.ticks / 20)} s ·{" "}
                  <span className={m.status === "finished" ? "text-leaf" : "text-gold"}>{m.status === "finished" ? "full record" : "live (public only)"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
