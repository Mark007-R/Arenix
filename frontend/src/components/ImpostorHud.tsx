"use client";

import { useEffect, useState } from "react";
import type { GameClient } from "@/game/net/client";
import type { WorldScene } from "@/game/scenes/WorldScene";
import { useHud, type HudStore } from "@/lib/store";

const SKILL_ICON: Record<string, string> = {
  swift: "💨",
  scout: "🔭",
  strongback: "💪",
  detective: "🔎",
  medic: "🛡️",
  lookout: "👁️",
};

type RoleId = "islander" | "impostor" | "sheriff" | "jester";

/** Name, colours and how-to-win text for each role. */
const ROLE_INFO: Record<RoleId, { name: string; icon: string; text: string; border: string; bg: string; color: string; glow: string; intro: string }> = {
  islander: {
    name: "Islander", icon: "🏝️", border: "border-leaf/70", bg: "bg-[#173018]", color: "text-leaf", glow: "rgba(134,211,95,.35)",
    text: "Finish the tower and light every beacon, report bodies, and vote out the impostor.",
    intro: "Repair the Watchtower and light all 5 beacons, report any body you find, and vote out every impostor.",
  },
  impostor: {
    name: "Impostor", icon: "🗡️", border: "border-ember", bg: "bg-[#3a1418]", color: "text-ember", glow: "rgba(214,69,59,.45)",
    text: "Eliminate islanders (K) when nobody is watching. Fake tasks to blend in, and sabotage to sow chaos.",
    intro: "Eliminate islanders when nobody is watching (press K next to them). Sabotage with fog or by dousing beacons. Lie in meetings. Win when you equal them in number — or when time runs out.",
  },
  sheriff: {
    name: "Sheriff", icon: "⭐", border: "border-gold", bg: "bg-[#33290f]", color: "text-gold", glow: "rgba(244,197,66,.4)",
    text: "You're an islander with one bullet (K). Shoot an impostor and they're gone — shoot an innocent and you die instead.",
    intro: "You're on the islanders' side, with one bullet. Press K next to someone to shoot: an impostor dies, but if you're wrong, you die instead. Choose carefully.",
  },
  jester: {
    name: "Jester", icon: "🃏", border: "border-[#c77dff]", bg: "bg-[#2a1636]", color: "text-[#d6a6ff]", glow: "rgba(199,125,255,.4)",
    text: "You win alone if the council votes you out. Act suspicious — but not so much they see through it.",
    intro: "You're on nobody's side. Get yourself voted out by the council and you win alone. Fake tasks, act a little shifty, and let them come for you.",
  },
};

function roleInfo(role: string | undefined) {
  return ROLE_INFO[(role ?? "islander") as RoleId] ?? ROLE_INFO.islander;
}

/** Role + skill card shown at the top of the mission panel in impostor mode. */
export function RoleCard({ store, client }: { store: HudStore; client: GameClient }) {
  const me = useHud(store, (s) => s.snapshot?.me);
  const mode = useHud(store, (s) => s.snapshot?.mode);
  if (mode !== "impostor" || !me?.role) return null;
  const info = roleInfo(me.role);
  const impostor = me.role === "impostor";
  const ghost = me.alive === false;
  let status: string | null = null;
  if (!ghost && impostor) status = (me.kill_cooldown ?? 0) > 0 ? `knife in ${Math.ceil(me.kill_cooldown ?? 0)}s` : "knife ready";
  if (!ghost && me.role === "sheriff") status = me.bullet_used ? "bullet spent" : "1 bullet";
  return (
    <div className={`mb-2 border-[3px] p-2 ${info.border} ${info.bg}`}>
      <div className="flex items-center justify-between">
        <span className={`font-bold uppercase tracking-wider ${info.color}`}>
          {ghost ? "👻 " : `${info.icon} `}{info.name}
        </span>
        {status && <span className="text-xs tabular-nums text-parchment/80">{status}</span>}
      </div>
      <p className="mt-1 text-xs text-parchment/80">
        {ghost
          ? "You are a ghost. Roam freely and chat with the other dead — the living can't see or hear you."
          : `${info.text}${
              impostor && me.fellow_impostors?.length ? ` Partner: ${me.fellow_impostors.map((f) => client.name(f)).join(", ")}.` : ""
            }`}
      </p>
      {me.skill && (
        <div className="mt-1 text-xs">
          <span className="text-gold">{SKILL_ICON[me.skill.id] ?? "✨"} {me.skill.name}: </span>
          <span className="text-parchment/80">{me.skill.text}</span>
          {me.skill.id === "medic" && (
            <span className="block text-parchment/60">
              {me.ability_used ? "Shield used." : "Click a name in the list to shield them."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Tower + beacons progress for impostor mode. */
export function BeaconProgress({ store }: { store: HudStore }) {
  const beacons = useHud(store, (s) => s.snapshot?.beacons);
  if (!beacons) return null;
  const ids = Object.keys(beacons);
  const lit = ids.filter((b) => beacons[b]).length;
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-sm">
        <span>Beacons</span>
        <span className="tabular-nums">{lit} / {ids.length}</span>
      </div>
      <div className="flex gap-1" aria-label={`${lit} of ${ids.length} beacons lit`}>
        {ids.map((b) => (
          <span key={b} className={`h-2 flex-1 border-2 border-ink ${beacons[b] ? "bg-[#f08a3c]" : "bg-[#120c1c]"}`} />
        ))}
      </div>
    </div>
  );
}

/** Big kill / shoot button for impostors and the sheriff (mirrors the K key; useful on touch screens). */
export function KillButton({ store, scene }: { store: HudStore; scene: () => WorldScene | null }) {
  const me = useHud(store, (s) => s.snapshot?.me);
  const phase = useHud(store, (s) => s.snapshot?.phase);
  const target = useHud(store, (s) => s.killTarget);
  if (me?.alive === false || phase !== "explore") return null;
  const sheriff = me?.role === "sheriff";
  if (!sheriff && me?.role !== "impostor") return null;
  // The sheriff's button only appears with someone in range, so it never invites a blind shot.
  if (sheriff && (me.bullet_used || !target)) return null;
  const cd = sheriff ? 0 : Math.ceil(me?.kill_cooldown ?? 0);
  const verb = sheriff ? "Shoot" : "Eliminate";
  return (
    <button
      className={`pointer-events-auto border-[3px] border-ink px-3 py-2 font-bold text-parchment disabled:opacity-50 ${
        sheriff ? "bg-[#8a6a14]" : "bg-[#9a3029]"
      } ${target && cd <= 0 ? "pulse-glow" : ""}`}
      disabled={!target || cd > 0}
      onClick={() => {
        const sc = scene();
        if (target && sc) sc.touch = { ...sc.touch, kill: true };
      }}
      title={sheriff ? "Fire your one bullet at the person next to you (K)" : "Eliminate the islander next to you (K)"}
    >
      {sheriff ? "🔫" : "🗡️"} {cd > 0 ? `${cd}s` : target ? `${verb} ${target.name}` : "No one in reach"}
    </button>
  );
}

/** Impostor sabotage: fog (islanders see less for a while) or douse a lit beacon. */
export function SabotageButtons({ store, client }: { store: HudStore; client: GameClient }) {
  const me = useHud(store, (s) => s.snapshot?.me);
  const phase = useHud(store, (s) => s.snapshot?.phase);
  const beacons = useHud(store, (s) => s.snapshot?.beacons);
  if (me?.role !== "impostor" || me.alive === false || phase !== "explore") return null;
  const cd = Math.ceil(me.sabotage_cooldown ?? 0);
  const anyLit = Object.values(beacons ?? {}).some(Boolean);
  const btn = "pointer-events-auto border-[3px] border-ink bg-[#3b2a55] px-2 py-1 text-sm font-bold text-parchment disabled:opacity-50";
  return (
    <div className="flex gap-2" role="group" aria-label="Sabotage">
      <button className={btn} disabled={cd > 0} onClick={() => client.sabotage("fog")} title="Islanders see much less for a while">
        🌫️ {cd > 0 ? `Fog ${cd}s` : "Fog"}
      </button>
      <button className={btn} disabled={cd > 0 || !anyLit} onClick={() => client.sabotage("douse")} title="Put out a lit beacon">
        💧 {cd > 0 ? `Douse ${cd}s` : "Douse beacon"}
      </button>
    </div>
  );
}

/** Thick mist over the screen while a fog sabotage lasts (impostors see through it). */
export function FogOverlay({ store }: { store: HudStore }) {
  const fog = useHud(store, (s) => s.snapshot?.fog_left ?? 0);
  const role = useHud(store, (s) => s.snapshot?.me?.role);
  if (fog <= 0) return null;
  const blind = role !== "impostor";
  return (
    <>
      {blind && (
        <div
          className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-700"
          style={{ background: "radial-gradient(circle at 50% 50%, transparent 18%, rgba(205,214,228,.55) 38%, rgba(190,200,216,.92) 60%)" }}
          aria-hidden
        />
      )}
      <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2 panel px-3 py-1 text-sm slide-down">
        🌫️ Fog! {blind ? "You can barely see" : "Islanders can barely see"} — {Math.ceil(fog)}s
      </div>
    </>
  );
}

/** Start-of-match splash: your role, partner and skill. */
export function RoleIntro({ store, client }: { store: HudStore; client: GameClient }) {
  const intro = useHud(store, (s) => s.intro);
  const me = useHud(store, (s) => s.snapshot?.me);
  const [hidden, setHidden] = useState<number | null>(null);
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setHidden(intro), 5500);
    return () => clearTimeout(t);
  }, [intro]);
  if (!intro || hidden === intro || !me?.role) return null;
  const impostor = me.role === "impostor";
  const info = roleInfo(me.role);
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-[#120c1c]/75 p-4"
      onClick={() => setHidden(intro)} role="dialog" aria-label="Your role">
      <div className={`panel pop-in max-w-md p-6 text-center ${info.border}`}
        style={{ boxShadow: `0 0 40px ${info.glow}, 0 4px 0 #120c1c` }}>
        <div className="text-sm uppercase tracking-[0.3em] text-parchment/70">You are</div>
        <div className={`text-5xl font-bold uppercase ${info.color}`}>{info.icon} {info.name}</div>
        <p className="mt-3 text-parchment/85">{info.intro}</p>
        {impostor && me.fellow_impostors && me.fellow_impostors.length > 0 && (
          <p className="mt-2 text-ember">Your partner: {me.fellow_impostors.map((f) => client.name(f)).join(", ")}</p>
        )}
        {me.skill && (
          <p className="mt-3 border-t-2 border-dusk pt-3">
            <span className="text-gold">{SKILL_ICON[me.skill.id]} {me.skill.name}</span> — {me.skill.text}
          </p>
        )}
        <p className="mt-4 text-xs text-parchment/50">Click to start</p>
      </div>
    </div>
  );
}
