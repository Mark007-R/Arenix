"use client";

import { useEffect, useRef, useState } from "react";
import type { GameClient } from "@/game/net/client";
import { place } from "@/lib/feed";
import { useHud, type HudStore } from "@/lib/store";
import { Portrait } from "./Portrait";
import { SafetyMenu } from "./SafetyMenu";
import { useSettings } from "@/lib/settings";

const TITLES = { discuss: "Council meeting — discuss", vote: "Council meeting — vote", reveal: "The council has spoken" };

/** Stable per-contestant name colour so a busy chat is easy to follow. */
const NAME_COLORS = ["#ffb4a2", "#9fd3f2", "#c9f29b", "#f2d59b", "#d8c2ff", "#f7a8d8", "#a8f0e0", "#ffd166", "#b5c7ff", "#f4a261"];
function nameColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length]!;
}

function MeetingChat({ client, store }: { client: GameClient; store: HudStore }) {
  const meeting = useHud(store, (s) => s.snapshot?.meeting ?? 0);
  const chat = useHud(store, (s) => s.chat);
  const muted = useHud(store, (s) => s.muted);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const roster = useHud(store, (s) => s.snapshot?.roster ?? []);
  const alive = useHud(store, (s) => s.snapshot?.roster.find((r) => r.id === s.you)?.alive ?? false);
  const ghost = client.isGhost;
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const hideChat = useSettings().hideChat;
  const lines = chat.filter((c) => c.meeting === meeting && !muted.includes(c.sender) && (!hideChat || c.mine));

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  function send() {
    const t = text.trim();
    if (t) client.say({ text: t });
    setText("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-[3px] border-ink bg-[#120c1c]">
      <div className="border-b-[3px] border-ink px-3 py-1 text-xs uppercase tracking-wider text-gold">
        Discussion {ghost && <span className="normal-case text-[#d8c2ff]">· ghost chat (only the dead can read you)</span>}
      </div>
      <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite" aria-label="Meeting chat">
        {hideChat && <p className="text-xs text-parchment/50">Other players&apos; chat is hidden (Settings).</p>}
        {lines.length === 0 && !hideChat && <p className="text-sm text-parchment/50">No one has spoken yet. Say what you saw!</p>}
        {lines.map((c) => {
          const r = roster.find((x) => x.id === c.sender);
          return (
            <div key={c.id} className={`flex gap-2 ${c.mine ? "flex-row-reverse text-right" : ""} ${c.ghost ? "opacity-70" : ""}`}>
              {r && <Portrait archetype={r.archetype} scale={1} className="mt-1 h-5 w-4 shrink-0" cosmetics={r.cosmetics} />}
              <div className={`max-w-[85%] border-2 px-2 py-1 text-sm ${c.mine ? "border-gold/60 bg-[#2d2440]" : "border-dusk bg-[#1f1630]"}`}>
                <div className="flex items-center gap-2 text-xs font-bold" style={{ color: c.mine ? "#ffe066" : nameColor(c.sender) }}>
                  <span>{c.mine ? "You" : c.senderName}{c.ghost && " 👻"}</span>
                  {!c.mine && (
                    <button className="ml-auto text-parchment/40 hover:text-parchment" aria-label={`Mute or report ${c.senderName}`}
                      onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}>⋯</button>
                  )}
                </div>
                <div className="break-words">{c.text}</div>
                {menuFor === c.id && (
                  <div className="mt-1 flex flex-wrap gap-1 text-left">
                    <SafetyMenu client={client} store={store} id={c.sender} onDone={() => setMenuFor(null)} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {alive || ghost ? (
        <div className="flex gap-1 border-t-[3px] border-ink p-2">
          <input
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => store.set({ typing: true })}
            onBlur={() => store.set({ typing: false })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") send();
            }}
            placeholder={ghost ? "Whisper to the other ghosts…" : "Where were you? Who do you suspect?"}
            aria-label="Meeting message"
            className="min-w-0 flex-1 border-[3px] border-ink bg-[#1f1630] px-2 py-1 text-sm outline-none focus:border-sky"
          />
          <button className="btn px-3 py-1 text-sm" onClick={send}>Send</button>
        </div>
      ) : (
        <p className="border-t-[3px] border-ink p-2 text-xs text-parchment/60">You can only watch.</p>
      )}
    </div>
  );
}

export function MeetingOverlay({ client, store }: { client: GameClient; store: HudStore }) {
  const snap = useHud(store, (s) => s.snapshot);
  const you = useHud(store, (s) => s.you);
  const lastResolved = useHud(store, (s) => s.lastVote);
  const cause = useHud(store, (s) => s.meetingCause);
  if (!snap || snap.status !== "running" || snap.phase === "explore") return null;
  const phase = snap.phase;
  const me = snap.roster.find((r) => r.id === you);
  const alive = snap.roster.filter((r) => r.alive);
  const dead = snap.roster.filter((r) => !r.alive);
  const myVote = snap.me?.vote ?? null;
  const canVote = phase === "vote" && !!me?.alive && !myVote;
  const ally = snap.me?.ally;
  const fellow = new Set(snap.me?.fellow_impostors ?? []);
  const reveal = phase === "reveal" ? lastResolved : null;
  const tally = (id: string) =>
    reveal ? Object.entries(reveal.votes).filter(([, t]) => t === id).map(([v]) => client.name(v)) : [];
  const impostorMode = snap.mode === "impostor";

  let revealText = "No one was voted out.";
  if (reveal?.eliminated) {
    const who = client.name(reveal.eliminated);
    revealText =
      reveal.was_impostor === true
        ? `${who} WAS an impostor! ${reveal.impostors_left ? `${reveal.impostors_left} still hiding.` : "The island is safe."}`
        : reveal.was_impostor === false
          ? `${who} was NOT an impostor…`
          : `${who} has been voted out.`;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-[#120c1c]/55 p-3 pt-16 sm:pt-20">
      <section className="panel pop-in pointer-events-auto flex max-h-[calc(100dvh-6rem)] w-full max-w-5xl flex-col p-4" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-gold">{TITLES[phase]}</h2>
          <span className="text-lg tabular-nums">{Math.ceil(snap.phase_left)}s</span>
        </div>
        {cause && phase !== "reveal" && (
          <p className={`text-sm ${cause.cause === "body" ? "text-ember" : "text-parchment/80"}`}>
            {cause.cause === "body"
              ? `☠️ ${client.name(cause.caller)} found ${client.name(cause.victim)}'s body in ${place(cause.region)}.`
              : cause.cause === "bell"
                ? `🔔 ${client.name(cause.caller)} rang the Council Bell.`
                : "⏰ Scheduled council meeting."}
            {dead.length > 0 && <span className="text-parchment/60"> Dead so far: {dead.map((d) => d.name).join(", ")}.</span>}
          </p>
        )}
        <p className="mb-3 text-sm text-parchment/70">
          {phase === "discuss" && (impostorMode
            ? cause?.cause === "body" ? "Share what you saw. Who was near the body? Who is lying?" : "Compare notes. Who has been acting strange?"
            : "Talk it over in chat. Who is playing everyone?")}
          {phase === "vote" && (me?.alive ? (myVote ? "Vote locked in. Waiting for the others…" : "Choose who to vote out — or skip.") : "You are spectating.")}
          {phase === "reveal" && <span className="text-base font-bold text-parchment">{revealText}</span>}
        </p>
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
          <div className="md:w-[55%]">
            <ul className="grid grid-cols-2 gap-2 lg:grid-cols-3">
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
                        <span className="block truncate font-bold" style={{ color: fellow.has(r.id) ? "#ff6b5e" : undefined }}>
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
          </div>
          <div className="flex min-h-[220px] flex-1 flex-col md:min-h-0">
            <MeetingChat client={client} store={store} />
          </div>
        </div>
      </section>
    </div>
  );
}
