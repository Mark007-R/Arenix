"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Portrait } from "@/components/Portrait";
import { ARCHETYPES } from "@/game/art/characters";

const KEYS = Object.keys(ARCHETYPES);
const PREFS_KEY = "arenix.prefs";

function loadPrefs(): { name: string; archetype: string; bots: number } {
  const fallback = { name: "", archetype: "knight", bots: 2 };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("knight");
  const [bots, setBots] = useState(2);

  useEffect(() => {
    const p = loadPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage after mount
    setName(p.name);
    setArchetype(KEYS.includes(p.archetype) ? p.archetype : "knight");
    setBots(Math.min(7, Math.max(0, p.bots)));
  }, []);

  const cleanName = name.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 20);
  const valid = cleanName.length > 0;

  function play() {
    if (!valid) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ name: cleanName, archetype, bots }));
    } catch {
      /* storage unavailable: fine */
    }
    const q = new URLSearchParams({ name: cleanName, archetype, bots: String(bots) });
    router.push(`/play?${q}`);
  }

  const chosen = ARCHETYPES[archetype]!;

  return (
    <main className="min-h-full bg-[radial-gradient(ellipse_at_top,#3f6fbf_0%,#2a1f3d_55%,#1f1630_100%)] px-4 py-8">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6">
        <header className="text-center">
          <h1 className="text-6xl font-bold tracking-widest text-gold drop-shadow-[0_4px_0_#120c1c] sm:text-7xl">ARENIX</h1>
          <p className="mt-2 text-lg text-parchment/85">Explore. Cooperate. Betray. Survive the island.</p>
        </header>

        <section className="panel w-full p-5 sm:p-6">
          <div className="grid gap-6 md:grid-cols-[1fr_240px]">
            <div>
              <label className="mb-1 block text-sm uppercase tracking-wider text-gold" htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && play()}
                maxLength={20}
                placeholder="Adventurer"
                className="w-full border-[3px] border-ink bg-[#120c1c] px-3 py-2 text-lg outline-none focus:border-sky"
              />

              <h2 className="mb-2 mt-5 text-sm uppercase tracking-wider text-gold">Choose your contestant</h2>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Character">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={k === archetype}
                    onClick={() => setArchetype(k)}
                    className={`flex flex-col items-center border-[3px] p-1 pt-2 ${
                      k === archetype ? "border-gold bg-dusk" : "border-ink bg-[#120c1c] hover:border-dusk"
                    }`}
                  >
                    <Portrait archetype={k} scale={3} />
                    <span className="mt-1 text-xs leading-tight">{ARCHETYPES[k]!.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 border-[3px] border-ink bg-[#120c1c] p-4 text-center">
              <Portrait archetype={archetype} scale={7} />
              <div className="text-xl font-bold text-gold">{chosen.label}</div>
              <p className="text-sm text-parchment/80">{chosen.blurb}</p>
              <p className="text-xs text-parchment/50">Cosmetic only — every contestant plays the same.</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <label htmlFor="bots" className="block text-sm uppercase tracking-wider text-gold">
                AI contestants: {bots}
              </label>
              <input id="bots" type="range" min={0} max={7} value={bots} onChange={(e) => setBots(Number(e.target.value))}
                className="w-56 accent-[#f4c542]" />
            </div>
            <button className="btn text-xl" onClick={play} disabled={!valid} aria-disabled={!valid}
              style={valid ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>
              ▶ Play practice match
            </button>
          </div>
        </section>

        <section className="panel w-full p-5 text-sm leading-relaxed text-parchment/85">
          <h2 className="mb-2 text-base font-bold text-gold">How to play</h2>
          <ul className="grid gap-1 sm:grid-cols-2">
            <li><b className="text-parchment">WASD / Arrows</b> — move</li>
            <li><b className="text-parchment">E or Space</b> — interact when a prompt appears</li>
            <li>Gather <b className="text-parchment">wood</b> in the forest and <b className="text-parchment">stone</b> in the mine.</li>
            <li>Carry up to 3 at a time and deliver them to the ruined <b className="text-parchment">Watchtower</b>.</li>
            <li>Repair it before time runs out. Top contributor is crowned MVP.</li>
            <li>AI contestants plan their own routes and compete for credit.</li>
          </ul>
          <p className="mt-3 text-xs text-parchment/50">
            Milestone 1 practice mode: one player against server-driven AI contestants. Rooms, alliances and voting arrive in later milestones.
          </p>
        </section>
      </div>
    </main>
  );
}
