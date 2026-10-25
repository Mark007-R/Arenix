"use client";

import { useEffect, useState } from "react";
import type { GameClient } from "@/game/net/client";
import { AllianceOffers } from "./AllianceOffers";
import { ChatPanel } from "./ChatPanel";
import { MeetingOverlay } from "./MeetingOverlay";
import { Minimap } from "./Minimap";
import { Portrait } from "./Portrait";
import type { HudStore } from "@/lib/store";
import { useHud } from "@/lib/store";
import type { Resource } from "@/shared/protocol";

function fmtTime(s: number): string {
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

const RES_COLOR: Record<Resource, string> = { wood: "#c58d55", stone: "#c4c9d2" };

function MissionPanel({ store }: { store: HudStore }) {
  const snap = useHud(store, (s) => s.snapshot);
  const region = useHud(store, (s) => s.region);
  if (!snap) return null;
  const m = snap.mission;
  const low = snap.time_left <= 30 && m.status === "active";
  return (
    <div className="panel w-64 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-gold">Mission</span>
        <span className={`text-lg font-bold tabular-nums ${low ? "text-ember" : "text-parchment"}`} aria-label="Time left">
          {fmtTime(snap.time_left)}
        </span>
      </div>
      <div className="mb-2 font-bold">{m.title}</div>
      {(Object.keys(m.required) as Resource[]).map((r) => {
        const pct = Math.min(100, (m.delivered[r] / Math.max(1, m.required[r])) * 100);
        return (
          <div key={r} className="mb-1.5">
            <div className="flex justify-between text-sm capitalize">
              <span>{r}</span>
              <span className="tabular-nums">{m.delivered[r]} / {m.required[r]}</span>
            </div>
            <div className="bar"><span style={{ width: `${pct}%`, background: RES_COLOR[r] }} /></div>
          </div>
        );
      })}
      <div className="mt-2 text-xs">
        <span className="text-parchment/70">Shrine: </span>
        {snap.shrine.status === "activated" ? (
          <span className="text-leaf">awakened ✔</span>
        ) : snap.shrine.status === "channeling" ? (
          <span className="text-[#d8c2ff]">ritual {snap.shrine.count}/{snap.shrine.required} · {Math.ceil(snap.shrine.window_left)}s left!</span>
        ) : (
          <span className="text-parchment/60">dormant (needs {snap.shrine.required} together)</span>
        )}
      </div>
      {snap.phase === "explore" && (
        <div className="mt-1 text-xs text-parchment/70">Next council in {Math.ceil(snap.phase_left)}s</div>
      )}
      {snap.me?.objective && (
        <div className="mt-2 border-t-2 border-dusk pt-2 text-xs">
          <span className="text-gold">Secret objective: </span>
          {snap.me.objective.text}
        </div>
      )}
      {region && <div className="mt-2 text-xs text-parchment/60">📍 {region}</div>}
    </div>
  );
}

function Scoreboard({ store, client }: { store: HudStore; client: GameClient }) {
  const snap = useHud(store, (s) => s.snapshot);
  const you = useHud(store, (s) => s.you);
  const [open, setOpen] = useState<string | null>(null);
  if (!snap) return null;
  const rows = [...snap.roster].sort((a, b) => Number(b.alive) - Number(a.alive) || b.score - a.score);
  const ally = snap.me?.ally ?? null;
  const outgoing = snap.me?.outgoing_proposals ?? [];
  const meAlive = snap.roster.find((r) => r.id === you)?.alive;
  return (
    <div className="panel pointer-events-auto w-[220px] p-2">
      <div className="mb-1 text-xs uppercase tracking-wider text-gold">Contestants</div>
      <ul className="space-y-0.5">
        {rows.map((c) => (
          <li key={c.id}>
            <button
              className={`flex w-full items-center gap-2 text-left text-sm ${c.id === you ? "text-[#ffe066]" : ""} ${c.alive ? "" : "line-through opacity-50"}`}
              onClick={() => setOpen(open === c.id ? null : c.id)}
              disabled={c.id === you || !c.alive || !meAlive}
              aria-expanded={open === c.id}
            >
              <Portrait archetype={c.archetype} scale={1} className="h-5 w-4" cosmetics={c.cosmetics} />
              <span className="flex-1 truncate">
                {c.name}
                {c.is_bot && <span className="ml-1 text-[10px] text-sky">AI</span>}
                {c.id === ally && <span title="Your ally"> 🤝</span>}
                {!c.alive && " 💀"}
              </span>
              <span className="tabular-nums">{c.score}</span>
            </button>
            {open === c.id && (
              <div className="my-1 flex flex-wrap gap-1 pl-6">
                {c.id === ally ? (
                  <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => { client.breakAlliance(); setOpen(null); }}>
                    Break alliance
                  </button>
                ) : outgoing.includes(c.id) ? (
                  <span className="text-xs text-parchment/60">Offer sent…</span>
                ) : (
                  <button className="btn px-2 py-0.5 text-xs" disabled={!!ally}
                    title={ally ? "You already have an ally" : "Allies share a bonus, see each other and can whisper"}
                    onClick={() => { client.propose(c.id); setOpen(null); }}>
                    Propose alliance
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pack({ store }: { store: HudStore }) {
  const snap = useHud(store, (s) => s.snapshot);
  const you = useHud(store, (s) => s.you);
  const me = snap?.contestants.find((c) => c.id === you);
  if (!me) return null;
  const units: Resource[] = [];
  for (const [r, n] of Object.entries(me.carrying) as [Resource, number][]) for (let i = 0; i < n; i++) units.push(r);
  return (
    <div className="panel flex items-center gap-2 px-3 py-2" aria-label="Your pack">
      <span className="mr-1 text-xs uppercase tracking-wider text-gold">Pack</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-8 w-8 items-center justify-center border-[3px] border-ink bg-[#120c1c] text-[10px] capitalize"
          title={units[i] ?? "empty"}>
          {units[i] && <span className="block h-4 w-4" style={{ background: RES_COLOR[units[i]!], boxShadow: "inset -2px -2px 0 rgba(0,0,0,.3)" }} />}
        </div>
      ))}
      <span className="ml-2 text-sm tabular-nums text-parchment/70">★ {me.score}</span>
    </div>
  );
}

function Feed({ store }: { store: HudStore }) {
  const feed = useHud(store, (s) => s.feed);
  const tone = { info: "text-parchment/80", good: "text-leaf", bad: "text-ember", mine: "text-[#ffe066]" } as const;
  return (
    <ul className="w-80 max-w-[90vw] space-y-0.5 text-sm drop-shadow-[0_2px_0_#120c1c]" aria-live="polite">
      {feed.map((f) => <li key={f.id} className={tone[f.tone]}>{f.text}</li>)}
    </ul>
  );
}

function Toast({ store }: { store: HudStore }) {
  const toast = useHud(store, (s) => s.toast);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show then auto-hide each new toast
    setVisible(toast.id);
    const t = setTimeout(() => setVisible(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || visible !== toast.id) return null;
  return <div className="panel px-4 py-2 text-center" role="status">{toast.text}</div>;
}

export function Hud({ store, client, onToggleMotion }: { store: HudStore; client: GameClient; onToggleMotion: () => void }) {
  const ping = useHud(store, (s) => s.pingMs);
  const reduced = useHud(store, (s) => s.reducedMotion);
  return (
    <div className="pointer-events-none absolute inset-0 select-none p-3">
      <div className="absolute left-3 top-3"><MissionPanel store={store} /></div>
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <Minimap store={store} />
        <Scoreboard store={store} client={client} />
      </div>
      <MeetingOverlay client={client} store={store} />
      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
        <Toast store={store} />
        <AllianceOffers client={client} store={store} />
      </div>
      <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-2">
        <Feed store={store} />
        <ChatPanel client={client} store={store} />
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2"><Pack store={store} /></div>
      <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-3 text-xs text-parchment/60">
        <span className="hidden sm:inline">WASD move · E interact · Enter chat · Q quick-chat</span>
        {ping !== null && <span className="tabular-nums">{ping} ms</span>}
        <button className="underline decoration-dotted" onClick={onToggleMotion} aria-pressed={reduced}>
          Reduced motion: {reduced ? "on" : "off"}
        </button>
      </div>
    </div>
  );
}
