"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { practiceUrl, type JoinParams } from "@/game/net/client";
import { useGameClient } from "@/lib/useGameClient";
import { useHud } from "@/lib/store";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { GameStage } from "./GameStage";
import { ResultModal } from "./ResultModal";

export default function PracticeView({ params }: { params: JoinParams }) {
  const [session, setSession] = useState(0);
  const url = useMemo(() => practiceUrl(params), [params]);
  const { store, client } = useGameClient(url, session);
  const matchId = useHud(store, (s) => s.matchId);
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#2f68b8]">
      {client && matchId && <GameStage key={matchId} client={client} store={store} />}
      <ResultModal
        store={store}
        actions={
          <>
            <button className="btn" onClick={() => setSession((n) => n + 1)} autoFocus>Play again</button>
            <Link className="btn btn-ghost" href="/">Main menu</Link>
          </>
        }
      />
      <ConnectionOverlay store={store} onRetry={() => setSession((n) => n + 1)} />
    </div>
  );
}
