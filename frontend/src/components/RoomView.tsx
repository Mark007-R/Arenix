"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { roomUrl } from "@/game/net/client";
import { useHud } from "@/lib/store";
import { useGameClient } from "@/lib/useGameClient";
import type { SeatGrant } from "@/shared/protocol";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { GameStage } from "./GameStage";
import { Lobby } from "./Lobby";
import { ResultModal } from "./ResultModal";

export default function RoomView({ seat }: { seat: SeatGrant }) {
  const [session, setSession] = useState(0);
  const url = useMemo(() => roomUrl(seat.code, seat.token), [seat]);
  const { store, client } = useGameClient(url, session);
  const matchId = useHud(store, (s) => s.matchId);
  const lobbyStatus = useHud(store, (s) => s.lobby?.status);
  // The match id the player is currently looking at; cleared by "Back to lobby".
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the server into each new match
    if (matchId) setViewing(matchId);
  }, [matchId]);

  const inGame = !!client && !!matchId && viewing === matchId;

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-ink">
      {client && !inGame && <Lobby client={client} store={store} you={seat.player_id} />}
      {inGame && (
        <div className="relative h-dvh w-full">
          <GameStage key={matchId} client={client} store={store} />
          <ResultModal
            store={store}
            actions={
              <>
                <button className="btn" onClick={() => setViewing(null)} autoFocus disabled={lobbyStatus === "running"}>
                  Back to lobby
                </button>
                <Link className="btn btn-ghost" href="/">Main menu</Link>
              </>
            }
          />
        </div>
      )}
      <ConnectionOverlay store={store} onRetry={() => setSession((n) => n + 1)} connectingText="Entering the room…" />
    </div>
  );
}
