"use client";

import { useEffect, useState } from "react";
import type { GameClient } from "@/game/net/client";
import { useHud, type HudStore } from "@/lib/store";

const SKILL_ICON: Record<string, string> = {
  swift: "💨",
  scout: "🔭",
  strongback: "💪",
  detective: "🔎",
  medic: "🛡️",
  lookout: "👁️",
};

/** Role + skill card shown at the top of the mission panel in impostor mode. */
export function RoleCard({ store, client }: { store: HudStore; client: GameClient }) {
  const me = useHud(store, (s) => s.snapshot?.me);
  const mode = useHud(store, (s) => s.snapshot?.mode);
  if (mode !== "impostor" || !me?.role) return null;
  const impostor = me.role === "impostor";
  const ghost = me.alive === false;
  return (
    <div className={`mb-2 border-[3px] p-2 ${impostor ? "border-ember bg-[#3a1418]" : "border-leaf/70 bg-[#173018]"}`}>
      <div className="flex items-center justify-between">
        <span className={`font-bold uppercase tracking-wider ${impostor ? "text-ember" : "text-leaf"}`}>
          {ghost ? "👻 " : ""}{impostor ? "Impostor" : "Islander"}
        </span>
        {impostor && !ghost && (
          <span className="text-xs tabular-nums text-parchment/80">
            {(me.kill_cooldown ?? 0) > 0 ? `knife in ${Math.ceil(me.kill_cooldown ?? 0)}s` : "knife ready"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-parchment/80">
        {ghost
          ? "You are a ghost. Roam freely and chat with the other dead — the living can't see or hear you."
          : impostor
            ? `Eliminate islanders (K) when nobody is watching. Fake tasks to blend in.${
                me.fellow_impostors?.length ? ` Partner: ${me.fellow_impostors.map((f) => client.name(f)).join(", ")}.` : ""
              }`
            : "Finish the tower and light every beacon, report bodies, and vote out the impostor."}
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

/** Big kill button for impostors (mirrors the K key; useful on touch screens). */
export function KillButton({ store, client }: { store: HudStore; client: GameClient }) {
  const me = useHud(store, (s) => s.snapshot?.me);
  const phase = useHud(store, (s) => s.snapshot?.phase);
  const target = useHud(store, (s) => s.killTarget);
  if (me?.role !== "impostor" || me.alive === false || phase !== "explore") return null;
  const cd = Math.ceil(me.kill_cooldown ?? 0);
  return (
    <button
      className="pointer-events-auto border-[3px] border-ink bg-[#9a3029] px-3 py-2 font-bold text-parchment disabled:opacity-50"
      disabled={!target || cd > 0}
      onClick={() => target && client.kill(target.id)}
      title="Eliminate the islander next to you (K)"
    >
      🗡️ {cd > 0 ? `${cd}s` : target ? `Eliminate ${target.name}` : "No one in reach"}
    </button>
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
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-[#120c1c]/75 p-4"
      onClick={() => setHidden(intro)} role="dialog" aria-label="Your role">
      <div className={`panel max-w-md p-6 text-center ${impostor ? "border-ember" : ""}`}>
        <div className="text-sm uppercase tracking-[0.3em] text-parchment/70">You are</div>
        <div className={`text-5xl font-bold ${impostor ? "text-ember" : "text-leaf"}`}>{impostor ? "IMPOSTOR" : "ISLANDER"}</div>
        <p className="mt-3 text-parchment/85">
          {impostor
            ? "Eliminate islanders when nobody is watching (press K next to them). Lie in meetings. Win when you equal them in number — or when time runs out."
            : "Repair the Watchtower and light all 5 beacons, report any body you find, and vote out every impostor."}
        </p>
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
