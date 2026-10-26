"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CharacterPicker } from "@/components/CharacterPicker";
import { ensureAccount } from "@/lib/account";
import { cleanName, joinRoom, loadPrefs, loadSeat, normalizeCode, savePrefs } from "@/lib/rooms";
import type { SeatGrant } from "@/shared/protocol";

const RoomView = dynamic(() => import("@/components/RoomView"), { ssr: false });

export default function RoomPage() {
  // useSearchParams needs a Suspense boundary in a statically exported page.
  return (
    <Suspense fallback={null}>
      <Room />
    </Suspense>
  );
}

function Room() {
  const code = normalizeCode(useSearchParams().get("code") ?? "");
  const [seat, setSeat] = useState<SeatGrant | null>(null);
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("knight");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = loadPrefs();
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from browser storage after mount */
    setSeat(loadSeat(code));
    setName(p.name);
    setArchetype(p.archetype);
    setChecked(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [code]);

  if (!checked) return null;
  if (seat) return <RoomView seat={seat} />;

  async function join() {
    const n = cleanName(name);
    if (!n) return setError("Enter a name first.");
    setBusy(true);
    setError(null);
    try {
      savePrefs({ ...loadPrefs(), name: n, archetype });
      await ensureAccount(n).catch(() => null);
      setSeat(await joinRoom(code, n, archetype));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Arrived via an invite link without a seat in this tab: join form.
  return (
    <main className="flex min-h-dvh items-center justify-center sky p-4">
      <section className="panel w-full max-w-lg p-6">
        <h1 className="text-2xl font-bold text-gold">Join room {code}</h1>
        <label className="mb-1 mt-4 block text-sm uppercase tracking-wider text-gold" htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && join()}
          className="w-full border-[3px] border-ink bg-[#120c1c] px-3 py-2 text-lg outline-none focus:border-sky"
        />
        <h2 className="mb-2 mt-4 text-sm uppercase tracking-wider text-gold">Choose your contestant</h2>
        <CharacterPicker value={archetype} onChange={setArchetype} compact />
        {error && <p className="mt-3 text-ember" role="alert">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button className="btn" onClick={join} disabled={busy}>{busy ? "Joining…" : "Join room"}</button>
          <Link className="btn btn-ghost" href="/">Back</Link>
        </div>
      </section>
    </main>
  );
}
