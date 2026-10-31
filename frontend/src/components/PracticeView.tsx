"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ensureAccount } from "@/lib/account";
import { practiceUrl, type JoinParams } from "@/game/net/client";
import { useGameClient } from "@/lib/useGameClient";
import { useHud } from "@/lib/store";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { GameStage } from "./GameStage";
import { ResultModal } from "./ResultModal";

export default function PracticeView({ params }: { params: JoinParams }) {
  const [session, setSession] = useState(0);
  const [auth, setAuth] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // Sign in as a guest so rewards and cosmetics apply; play anonymously if the server can't.
    ensureAccount(params.name)
      .then(async (a) => (a ? (await api<{ ticket: string }>("/api/auth/ws-ticket", { method: "POST" })).ticket : null))
      .then((ticket) => setAuth(ticket))
      .catch(() => setAuth(null));
  }, [params.name, session]);
  const url = useMemo(() => (auth === undefined ? null : practiceUrl(params, auth ?? undefined)), [params, auth]);
  const { store, client } = useGameClient(url, session);
  const matchId = useHud(store, (s) => s.matchId);
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#a9bcbd]">
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
