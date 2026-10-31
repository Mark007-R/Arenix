"use client";

import { useState } from "react";
import { markTutorialSeen } from "@/lib/settings";

const STEPS: { icon: string; title: string; text: string }[] = [
  { icon: "🏝️", title: "Welcome to ARENIX", text: "Everyone gets a secret role. Most are islanders — but one (two in bigger games) is an impostor." },
  { icon: "🪓", title: "Islanders: do the tasks", text: "Gather wood (forest, orchard) and stone (mine, quarry) with E, deliver them to the Watchtower, and carry wood to light the 5 beacons. Finish everything to win." },
  { icon: "🗡️", title: "Impostors: strike unseen", text: "Stand next to an islander and press K. Anyone nearby sees it — so wait until you're alone. Fake tasks to blend in. You win when you equal the islanders." },
  { icon: "⭐", title: "Sheriff, jester and sabotage", text: "From 6 players one islander is the sheriff, with one bullet (K): hit an impostor and they die, hit an innocent and the sheriff dies. From 9 there's a jester who wins if voted out. Impostors can sabotage with fog or by dousing a beacon." },
  { icon: "☠️", title: "Bodies and meetings", text: "Found a body? Press E to report it. The council meets: say where you were, accuse, defend, then vote someone out — or skip. Ejections are confirmed." },
  { icon: "✨", title: "Your skill", text: "Every match you get a random skill: Swift, Scout, Strongback, Detective, Medic or Lookout. Use it to find — or hide — the truth." },
  { icon: "👻", title: "Ghosts and fair play", text: "If you die you become a ghost: roam freely and chat with other ghosts. Be kind — mute or report anyone who isn't, from the player list." },
];

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const close = () => {
    markTutorialSeen();
    onClose();
  };
  return (
    <div className="pop-in fixed inset-0 z-[60] flex items-center justify-center bg-well/75 p-4" role="dialog" aria-label="How to play">
      <div className="panel w-full max-w-md p-6 text-center">
        <div className="text-5xl" aria-hidden>{step.icon}</div>
        <h2 className="mt-2 text-2xl font-bold text-gold">{step.title}</h2>
        <p className="mt-2 min-h-[6rem] text-parchment/85">{step.text}</p>
        <div className="my-3 flex justify-center gap-1.5" aria-hidden>
          {STEPS.map((_, k) => <span key={k} className={`h-2 w-2 ${k === i ? "bg-gold" : "bg-dusk"}`} />)}
        </div>
        <div className="flex justify-between gap-2">
          <button className="btn btn-ghost" onClick={close}>Skip</button>
          <div className="flex gap-2">
            {i > 0 && <button className="btn btn-ghost" onClick={() => setI(i - 1)}>Back</button>}
            <button className="btn" autoFocus onClick={() => (last ? close() : setI(i + 1))}>{last ? "Let's play!" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
