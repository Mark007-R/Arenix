"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ARCHETYPE_KEYS, CharacterPicker } from "@/components/CharacterPicker";
import { Portrait } from "@/components/Portrait";
import { ARCHETYPES } from "@/game/archetypes";
import Link from "next/link";
import { HowToPlay } from "@/components/HowToPlay";
import { SettingsMenu } from "@/components/SettingsMenu";
import { ensureAccount } from "@/lib/account";
import { HomeDiorama } from "@/components/HomeDiorama";
import { PublicRooms } from "@/components/PublicRooms";
import { SupportLink } from "@/components/SupportLink";
import { cleanName, createRoom, loadPrefs, normalizeCode, quickPlay, roomPath, savePrefs } from "@/lib/rooms";

const TITLE: [string, string][] = [
  ["A", "#e4572e"], ["R", "#f2a62b"], ["E", "#1f9d6b"], ["N", "#2f80ed"], ["I", "#7b5ba8"], ["X", "#e03e3e"],
];

const MODES = {
  practice: { color: "#1f9d6b", icon: "🏝️" },
  create: { color: "#2f80ed", icon: "🏰" },
  join: { color: "#e4572e", icon: "🎟️" },
};

const HOW_TO = [
  { icon: "🪓", title: "Do your tasks", text: "Gather wood and stone, repair the Watchtower, light all 5 beacons." },
  { icon: "🗡️", title: "Someone's an impostor", text: "They strike when nobody's watching. Could be anyone. Could be you." },
  { icon: "🔔", title: "Call the council", text: "Report a body or ring the bell, argue in the chat, then vote someone out." },
  { icon: "✨", title: "Random skills", text: "Swift, Scout, Detective, Medic… a new power every match." },
  { icon: "⭐", title: "Sheriff & Jester", text: "Bigger games add a sheriff with one bullet and a jester who wants to be voted out." },
  { icon: "👻", title: "Ghosts keep playing", text: "Dead? Roam unseen and gossip with the other ghosts." },
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("knight");
  const [bots, setBots] = useState(5);
  const [fillTo, setFillTo] = useState(6);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    const p = loadPrefs();
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from localStorage after mount */
    setName(p.name);
    setArchetype(ARCHETYPE_KEYS.includes(p.archetype) ? p.archetype : "knight");
    setBots(Math.min(7, Math.max(4, p.bots)));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const clean = cleanName(name);
  const valid = clean.length > 0;

  function remember() {
    savePrefs({ name: clean, archetype, bots });
  }

  function practice() {
    if (!valid) return setError("Enter a name first.");
    remember();
    router.push(`/play?${new URLSearchParams({ name: clean, archetype, bots: String(bots) })}`);
  }

  async function create() {
    if (!valid) return setError("Enter a name first.");
    remember();
    setBusy(true);
    setError(null);
    try {
      await ensureAccount(clean).catch(() => null); // optional: rewards + cosmetics when the server has a DB
      const grant = await createRoom(clean, archetype, fillTo, isPublic);
      router.push(roomPath(grant.code));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function quick() {
    if (!valid) return setError("Enter a name first.");
    remember();
    setBusy(true);
    setError(null);
    try {
      await ensureAccount(clean).catch(() => null);
      const grant = await quickPlay(clean, archetype);
      router.push(roomPath(grant.code));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function join() {
    const c = normalizeCode(code);
    if (c.length !== 6) return setError("Room codes have 6 characters.");
    if (valid) remember();
    router.push(roomPath(c));
  }

  const chosen = ARCHETYPES[archetype]!;
  const [help, setHelp] = useState(false);

  return (
    <main className="sky min-h-full px-4 py-8">
      <span className="cloud left-0 top-16 w-16" style={{ animationDuration: "70s" }} aria-hidden />
      <span className="cloud left-0 top-40 w-24" style={{ animationDuration: "95s", animationDelay: "-40s" }} aria-hidden />
      <span className="cloud left-0 top-72 w-12" style={{ animationDuration: "60s", animationDelay: "-20s" }} aria-hidden />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-6">
        <div className="absolute right-0 top-0"><SettingsMenu /></div>
        <header className="text-center">
          <h1 className="title-wave font-mono text-6xl font-bold tracking-widest sm:text-7xl" aria-label="ARENIX">
            {TITLE.map(([letter, color], i) => (
              <span key={i} style={{ color, animationDelay: `${i * 0.12}s` }} aria-hidden>{letter}</span>
            ))}
          </h1>
          <p className="mt-2 text-lg text-parchment/85">Do your tasks. Find the impostor. <b className="text-ember">Or be one.</b></p>
          <HomeDiorama archetype={archetype} />
          <button className="btn btn-ghost mt-3 text-sm" onClick={() => setHelp(true)}>📖 How to play</button>{" "}
          <Link href="/collection" className="btn btn-ghost mt-3 text-sm" onClick={() => valid && remember()}>🎁 Collection &amp; Crates</Link>{" "}
          <Link href="/lab" className="btn btn-ghost mt-3 text-sm">🔬 Agent Lab</Link>{" "}
          <Link href="/leaderboard" className="btn btn-ghost mt-3 text-sm">🏆 Leaderboard</Link>{" "}
          <Link href="/account" className="btn btn-ghost mt-3 text-sm">👤 Account</Link>
        </header>

        <section className="panel w-full p-5 sm:p-6">
          <div className="grid gap-6 md:grid-cols-[1fr_240px]">
            <div>
              <label className="mb-1 block text-sm uppercase tracking-wider text-gold" htmlFor="name">Your name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="Adventurer"
                className="w-full border-[1.5px] border-ink bg-well px-3 py-2 text-lg outline-none focus:border-sky"
              />
              <h2 className="mb-2 mt-5 text-sm uppercase tracking-wider text-gold">Choose your contestant</h2>
              <CharacterPicker value={archetype} onChange={setArchetype} />
            </div>
            <div className="flex flex-col items-center gap-3 border-[1.5px] border-ink bg-well p-4 text-center">
              <Portrait archetype={archetype} scale={7} />
              <div className="text-xl font-bold text-gold">{chosen.label}</div>
              <p className="text-sm text-parchment/80">{chosen.blurb}</p>
              <p className="text-xs text-parchment/50">Cosmetic only — every contestant plays the same.</p>
            </div>
          </div>
          {error && <p className="mt-4 text-ember" role="alert">{error}</p>}
          <button className="btn pulse-glow mt-5 w-full py-3 text-xl" onClick={quick} disabled={busy}>
            {busy ? "Finding a room…" : "⚡ Quick play"}
          </button>
          <p className="mt-1 text-center text-xs text-parchment/60">Jump into a public match with other players — AI fills the empty seats.</p>
        </section>

        <PublicRooms
          onJoin={(c) => {
            if (valid) remember();
            router.push(roomPath(c));
          }}
        />

        <div className="grid w-full gap-4 md:grid-cols-3">
          <section className="panel mode-card flex flex-col gap-3 p-5" style={{ borderTopColor: MODES.practice.color }}>
            <div className="mode-icon" aria-hidden>{MODES.practice.icon}</div>
            <h2 className="text-lg font-bold" style={{ color: MODES.practice.color }}>Practice</h2>
            <p className="text-sm text-parchment/75">Solo match against AI contestants.</p>
            <label htmlFor="bots" className="text-sm">AI contestants: {bots}</label>
            <input id="bots" type="range" min={4} max={7} value={bots} onChange={(e) => setBots(Number(e.target.value))} className="accent-[#1f9d6b]" />
            <button className="btn mt-auto" style={{ background: MODES.practice.color }} onClick={practice}>▶ Play practice</button>
          </section>
          <section className="panel mode-card flex flex-col gap-3 p-5" style={{ borderTopColor: MODES.create.color }}>
            <div className="mode-icon" aria-hidden>{MODES.create.icon}</div>
            <h2 className="text-lg font-bold" style={{ color: MODES.create.color }}>Create room</h2>
            <p className="text-sm text-parchment/75">Get a code to share with friends. AI fills empty seats.</p>
            <label htmlFor="fill" className="text-sm">Contestants: {fillTo}</label>
            <input id="fill" type="range" min={5} max={10} value={fillTo} onChange={(e) => setFillTo(Number(e.target.value))} className="accent-[#1f9d6b]" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-[#1f9d6b]" />
              List in public rooms
            </label>
            <button className="btn mt-auto" style={{ background: MODES.create.color }} onClick={create} disabled={busy}>
              {busy ? "Creating…" : "Create room"}
            </button>
          </section>
          <section className="panel mode-card flex flex-col gap-3 p-5" style={{ borderTopColor: MODES.join.color }}>
            <div className="mode-icon" aria-hidden>{MODES.join.icon}</div>
            <h2 className="text-lg font-bold" style={{ color: MODES.join.color }}>Join room</h2>
            <p className="text-sm text-parchment/75">Enter the 6-character code from your host.</p>
            <input
              aria-label="Room code"
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder="ABC123"
              className="w-full border-[1.5px] border-ink bg-well px-3 py-2 text-center text-2xl tracking-[0.3em] uppercase outline-none focus:border-sky"
            />
            <button className="btn mt-auto" style={{ background: MODES.join.color }} onClick={join}>Join</button>
          </section>
        </div>

        <section className="panel w-full p-5 text-sm leading-relaxed text-parchment/85">
          <h2 className="mb-3 text-base font-bold text-gold">How to play</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {HOW_TO.map((h) => (
              <li key={h.title} className="flex gap-3 border-[1.5px] border-ink bg-well p-3">
                <span className="text-2xl leading-none" aria-hidden>{h.icon}</span>
                <span className="min-w-0">
                  <b className="block text-parchment">{h.title}</b>
                  <span className="text-parchment/75">{h.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-parchment/60">
            <b>Keys:</b> WASD / arrows move · E interact · K eliminate (impostors) or shoot (sheriff) · Enter chat · Q quick-chat
          </p>
          <p className="mt-1 text-xs text-parchment/50">
            AI contestants are rule-based: they act and talk only from what they actually saw (no LLM in this mode).
          </p>
        </section>
        {help && <HowToPlay onClose={() => setHelp(false)} />}
        <SupportLink className="text-sm" />
        <footer className="pb-4 text-center text-xs text-parchment/50">
          For players 13 and older · <Link className="underline" href="/privacy">Privacy</Link> ·{" "}
          <Link className="underline" href="/terms">Terms</Link> · Be kind: report abuse from the in-game player list.
        </footer>
      </div>
    </main>
  );
}
