"use client";

import type { GameClient } from "@/game/net/client";
import { useHud, type HudStore } from "@/lib/store";
import { Portrait } from "./Portrait";

const TITLES = { discuss: "Council meeting — discuss", vote: "Council meeting — vote", reveal: "The council has spoken" };

export function MeetingOverlay({ client, store }: { client: GameClient; store: HudStore }) {
  const snap = useHud(store, (s) => s.snapshot);
  const you = useHud(store, (s) => s.you);
  const lastResolved = useHud(store, (s) => s.lastVote);
  if (!snap || snap.status !== "running" || snap.phase === "explore") return null;
  const phase = snap.phase;
  const me = snap.roster.find((r) => r.id === you);
  const alive = snap.roster.filter((r) => r.alive);
  const myVote = snap.me?.vote ?? null;
  const canVote = phase === "vote" && !!me?.alive && !myVote;
  const ally = snap.me?.ally;
  const reveal = phase === "reveal" ? lastResolved : null;
  const tally = (id: string) =>
    reveal ? Object.entries(reveal.votes).filter(([, t]) => t === id).map(([v]) => client.name(v)) : [];

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-[#120c1c]/45 p-4 pt-24">
      <section className="panel pointer-events-auto w-full max-w-2xl p-4" aria-live="polite">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold text-gold">{TITLES[phase]}</h2>
          <span className="text-lg tabular-nums">{Math.ceil(snap.phase_left)}s</span>
        </div>
        <p className="mb-3 text-sm text-parchment/70">
          {phase === "discuss" && "Talk it over in chat. Who is playing everyone?"}
          {phase === "vote" && (me?.alive ? (myVote ? "Vote locked in. Waiting for the others…" : "Choose who to vote out — or skip.") : "You are spectating.")}
          {phase === "reveal" && (reveal?.eliminated ? `${client.name(reveal.eliminated)} has been voted out.` : "No one was voted out.")}
        </p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {alive.map((r) => {
            const voted = snap.voted.includes(r.id);
            const votesFor = tally(r.id);
            const out = reveal?.eliminated === r.id;
            return (
              <li key={r.id}>
                <button
                  disabled={!canVote || r.id === you}
                  onClick={() => client.vote(r.id)}
                  className={`flex w-full items-center gap-2 border-[3px] p-2 text-left ${out ? "border-ember" : myVote === r.id ? "border-gold" : "border-ink"} bg-[#120c1c] ${canVote && r.id !== you ? "hover:border-gold" : ""}`}
                >
                  <Portrait archetype={r.archetype} scale={2} cosmetics={r.cosmetics} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {r.name}
                      {r.id === you && " (you)"}
                      {r.id === ally && " 🤝"}
                    </span>
                    <span className="text-xs text-parchment/60">
                      {phase !== "discuss" && (voted ? "✔ voted" : phase === "reveal" ? "abstained" : "thinking…")}
                    </span>
                    {votesFor.length > 0 && <span className="block text-xs text-ember">{votesFor.join(", ")}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {phase === "vote" && me?.alive && (
          <div className="mt-3 flex justify-end">
            <button className="btn btn-ghost" disabled={!canVote} onClick={() => client.vote(null)}>
              {myVote === "skip" ? "Skipped" : "Skip vote"}
            </button>
          </div>
        )}
        {reveal && reveal.skip > 0 && <p className="mt-2 text-xs text-parchment/60">{reveal.skip} skipped.</p>}
      </section>
    </div>
  );
}
