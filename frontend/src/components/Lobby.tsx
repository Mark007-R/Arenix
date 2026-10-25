"use client";

import Link from "next/link";
import { useState } from "react";
import { ARCHETYPES } from "@/game/art/characters";
import type { GameClient } from "@/game/net/client";
import { useHud, type HudStore } from "@/lib/store";
import { CharacterPicker } from "./CharacterPicker";
import { MapPreview } from "./MapPreview";
import { Portrait } from "./Portrait";

export function Lobby({ client, store, you }: { client: GameClient; store: HudStore; you: string }) {
  const lobby = useHud(store, (s) => s.lobby);
  const [copied, setCopied] = useState(false);
  if (!lobby) return null;
  const me = lobby.seats.find((s) => s.player_id === you);
  const isHost = !!me?.is_host;
  const humans = lobby.seats.length;
  const aiCount = Math.max(0, lobby.fill_to - humans);
  const open = lobby.capacity - Math.max(lobby.fill_to, humans);
  const waitingFor = lobby.seats.filter((s) => s.connected && !s.ready).map((s) => s.name);

  async function copyInvite() {
    const link = `${window.location.origin}/room/${lobby!.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(ellipse_at_top,#3f6fbf_0%,#2a1f3d_55%,#1f1630_100%)] px-4 py-6">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_320px]">
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-gold">Room code</div>
              <div className="text-4xl font-bold tracking-[0.3em]" data-testid="room-code">{lobby.code}</div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={copyInvite}>{copied ? "Copied!" : "Copy invite link"}</button>
              <Link className="btn btn-ghost" href="/">Leave</Link>
            </div>
          </div>

          <h2 className="mb-2 mt-5 text-sm uppercase tracking-wider text-gold">
            Contestants ({humans} {humans === 1 ? "player" : "players"} + {aiCount} AI)
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lobby.seats.map((s) => (
              <li key={s.player_id} className={`flex items-center gap-3 border-[3px] p-2 ${s.player_id === you ? "border-gold" : "border-ink"} bg-[#120c1c]`}>
                <Portrait archetype={s.archetype} scale={2} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">
                    {s.name} {s.is_host && <span title="Host">👑</span>} {s.player_id === you && <span className="text-xs text-gold">(you)</span>}
                  </div>
                  <div className="text-xs text-parchment/60">{ARCHETYPES[s.archetype]?.label ?? s.archetype}</div>
                </div>
                {!s.connected ? (
                  <span className="text-xs text-parchment/50">reconnecting…</span>
                ) : s.ready ? (
                  <span className="text-sm font-bold text-leaf">✔ Ready</span>
                ) : (
                  <span className="text-sm text-parchment/60">Not ready</span>
                )}
              </li>
            ))}
            {Array.from({ length: aiCount }, (_, i) => (
              <li key={`ai${i}`} className="flex items-center gap-3 border-[3px] border-dashed border-dusk bg-[#120c1c]/60 p-2 text-parchment/70">
                <span className="flex h-10 w-8 items-center justify-center text-xl">🤖</span>
                <div className="flex-1">
                  <div className="font-bold">AI contestant</div>
                  <div className="text-xs">
                    {lobby.ai_mode === "anthropic"
                      ? "Claude strategist · negotiates, allies, votes (rule-based fallback)"
                      : lobby.ai_mode === "heuristic"
                        ? "Heuristic strategist · negotiates via the agent protocol"
                        : "Rule-based policy · plans routes, competes for resources"}
                  </div>
                </div>
              </li>
            ))}
            {open > 0 && (
              <li className="flex items-center justify-center border-[3px] border-dashed border-ink p-2 text-sm text-parchment/40 sm:col-span-2">
                {open} open {open === 1 ? "seat" : "seats"} — share the code to invite friends
              </li>
            )}
          </ul>

          <h2 className="mb-2 mt-5 text-sm uppercase tracking-wider text-gold">Your contestant</h2>
          <CharacterPicker value={me?.archetype ?? "knight"} onChange={(a) => client.send({ type: "set_archetype", archetype: a })} compact />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <button
              className={`btn ${me?.ready ? "btn-ghost" : ""}`}
              onClick={() => client.send({ type: "ready", ready: !me?.ready })}
              aria-pressed={!!me?.ready}
            >
              {me?.ready ? "Not ready" : "✔ I'm ready"}
            </button>
            {isHost ? (
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm">
                  <span className="mr-2 text-gold">Total contestants: {lobby.fill_to}</span>
                  <input
                    type="range"
                    min={Math.max(1, humans)}
                    max={lobby.capacity}
                    value={lobby.fill_to}
                    onChange={(e) => client.send({ type: "set_fill", fill_to: Number(e.target.value) })}
                    className="w-40 accent-[#f4c542] align-middle"
                  />
                </label>
                <button
                  className="btn"
                  disabled={!lobby.can_start}
                  style={lobby.can_start ? undefined : { opacity: 0.5, cursor: "not-allowed" }}
                  onClick={() => client.send({ type: "start" })}
                >
                  ▶ Start match
                </button>
              </div>
            ) : (
              <span className="text-sm text-parchment/60">The host starts the match when everyone is ready.</span>
            )}
          </div>
          {waitingFor.length > 0 && (
            <p className="mt-2 text-xs text-parchment/60">Waiting for: {waitingFor.join(", ")}</p>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="panel p-4">
            <h2 className="mb-2 font-bold text-gold">Emerald Isle</h2>
            <MapPreview mapId={lobby.map_id} />
          </section>
          <section className="panel p-4 text-sm leading-relaxed text-parchment/85">
            <h2 className="mb-1 font-bold text-gold">Rules</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Gather wood and stone to repair the Watchtower (+10 per unit, +50 to every contributor).</li>
              <li>Wake the Ancient Shrine: three contestants must channel within 10 seconds (+40 each).</li>
              <li>Every 75 s — or when someone rings the Council Bell — the council meets and votes someone out.</li>
              <li>Form one alliance: allies share a delivery bonus, see each other and can whisper. Voting against your ally is a public betrayal.</li>
              <li>You get a secret objective (+60). Survivors get +50. After 7 minutes, or when two remain, the top-scoring survivor wins.</li>
            </ul>
          </section>
          {lobby.last_result && (
            <section className="panel p-4 text-sm">
              <h2 className="mb-1 font-bold text-gold">Last match</h2>
              <p>
                {lobby.last_result.winner
                  ? `${lobby.last_result.standings.find((s) => s.id === lobby.last_result!.winner)?.name} was MVP.`
                  : "Time ran out — no winner."}
              </p>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
