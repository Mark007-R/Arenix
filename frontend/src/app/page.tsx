"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ARCHETYPE_KEYS, CharacterPicker } from "@/components/CharacterPicker";
import { Portrait } from "@/components/Portrait";
import { ARCHETYPES } from "@/game/art/characters";
import Link from "next/link";
import { HowToPlay } from "@/components/HowToPlay";
import { SettingsMenu } from "@/components/SettingsMenu";
import { ensureAccount } from "@/lib/account";
import { PublicRooms } from "@/components/PublicRooms";
import { cleanName, createRoom, loadPrefs, normalizeCode, quickPlay, roomPath, savePrefs } from "@/lib/rooms";

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
          <h1 className="title-bob text-6xl font-bold tracking-widest text-gold sm:text-7xl">ARENIX</h1>
          <p className="mt-2 text-lg text-parchment/85">Do your tasks. Find the impostor. Or be one.</p>
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
                className="w-full border-[3px] border-ink bg-[#120c1c] px-3 py-2 text-lg outline-none focus:border-sky"
              />
              <h2 className="mb-2 mt-5 text-sm uppercase tracking-wider text-gold">Choose your contestant</h2>
              <CharacterPicker value={archetype} onChange={setArchetype} />
            </div>
            <div className="flex flex-col items-center gap-3 border-[3px] border-ink bg-[#120c1c] p-4 text-center">
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
          <section className="panel flex flex-col gap-3 p-5">
            <h2 className="text-lg font-bold text-gold">Practice</h2>
            <p className="text-sm text-parchment/75">Solo match against AI contestants.</p>
            <label htmlFor="bots" className="text-sm">AI contestants: {bots}</label>
            <input id="bots" type="range" min={4} max={7} value={bots} onChange={(e) => setBots(Number(e.target.value))} className="accent-[#f4c542]" />
            <button className="btn mt-auto" onClick={practice}>▶ Play practice</button>
          </section>
          <section className="panel flex flex-col gap-3 p-5">
            <h2 className="text-lg font-bold text-gold">Create room</h2>
            <p className="text-sm text-parchment/75">Get a code to share with friends. AI fills empty seats.</p>
            <label htmlFor="fill" className="text-sm">Contestants: {fillTo}</label>
            <input id="fill" type="range" min={5} max={10} value={fillTo} onChange={(e) => setFillTo(Number(e.target.value))} className="accent-[#f4c542]" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-[#f4c542]" />
              List in public rooms
            </label>
            <button className="btn mt-auto" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create room"}</button>
          </section>
          <section className="panel flex flex-col gap-3 p-5">
            <h2 className="text-lg font-bold text-gold">Join room</h2>
            <p className="text-sm text-parchment/75">Enter the 6-character code from your host.</p>
            <input
              aria-label="Room code"
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder="ABC123"
              className="w-full border-[3px] border-ink bg-[#120c1c] px-3 py-2 text-center text-2xl tracking-[0.3em] uppercase outline-none focus:border-sky"
            />
            <button className="btn mt-auto" onClick={join}>Join</button>
          </section>
        </div>

        <section className="panel w-full p-5 text-sm leading-relaxed text-parchment/85">
          <h2 className="mb-2 text-base font-bold text-gold">How to play</h2>
          <ul className="grid gap-1 sm:grid-cols-2">
            <li><b className="text-parchment">WASD / Arrows</b> move · <b className="text-parchment">E / Space</b> interact</li>
            <li><b className="text-parchment">Enter</b> chat · <b className="text-parchment">K</b> eliminate (impostors) · click a name to ally</li>
            <li>Someone is secretly the <b className="text-ember">impostor</b>. Everyone else is an islander.</li>
            <li>Islanders: repair the <b className="text-parchment">Watchtower</b>, light the 5 <b className="text-parchment">beacons</b>, report bodies.</li>
            <li>Impostor: eliminate islanders unseen, lie at the <b className="text-parchment">council</b>, don&apos;t get voted out.</li>
            <li>Every match you get a random <b className="text-parchment">skill</b> — Swift, Scout, Detective, Medic…</li>
          </ul>
          <p className="mt-3 text-xs text-parchment/50">
            AI contestants are rule-based: they act and talk only from what they actually saw (no LLM in this mode).
          </p>
        </section>
        {help && <HowToPlay onClose={() => setHelp(false)} />}
        <footer className="pb-4 text-center text-xs text-parchment/50">
          For players 13 and older · <Link className="underline" href="/privacy">Privacy</Link> ·{" "}
          <Link className="underline" href="/terms">Terms</Link> · Be kind: report abuse from the in-game player list.
        </footer>
      </div>
    </main>
  );
}
