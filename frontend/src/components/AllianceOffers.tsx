"use client";

import type { GameClient } from "@/game/net/client";
import { useHud, type HudStore } from "@/lib/store";

/** Incoming alliance offers with Accept / Decline. */
export function AllianceOffers({ client, store }: { client: GameClient; store: HudStore }) {
  const incoming = useHud(store, (s) => s.snapshot?.me?.incoming_proposals ?? []);
  if (incoming.length === 0) return null;
  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      {incoming.map((pid) => (
        <div key={pid} className="panel flex items-center gap-3 px-3 py-2" role="alert">
          <span>🤝 <b>{client.name(pid)}</b> offers an alliance</span>
          <button className="btn px-2 py-1 text-sm" onClick={() => client.respond(pid, true)}>Accept</button>
          <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => client.respond(pid, false)}>Decline</button>
        </div>
      ))}
    </div>
  );
}
