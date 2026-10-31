"use client";

import { useEffect, useState } from "react";
import { listPublicRooms, type PublicRoom } from "@/lib/rooms";
import { MAP_NAMES } from "@/lib/social";

const REFRESH_MS = 5000;

/** Open public lobbies anyone can join, refreshed every few seconds. */
export function PublicRooms({ onJoin }: { onJoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listPublicRooms()
        .then((r) => {
          if (!alive) return;
          setRooms(r);
          setError(false);
        })
        .catch(() => alive && setError(true));
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="panel w-full p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gold">Public rooms</h2>
        <span className="text-xs text-parchment/50">updates live</span>
      </div>
      {error ? (
        <p className="text-sm text-ember">Could not reach the server.</p>
      ) : rooms === null ? (
        <p className="text-sm text-parchment/60">Looking for rooms…</p>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-parchment/70">No open rooms right now — hit Quick play to start one, or create a public room.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rooms.map((r) => (
            <li key={r.code} className="pop-in flex items-center justify-between gap-2 border-[1.5px] border-ink bg-well p-2">
              <div className="min-w-0 text-sm">
                <div className="truncate font-bold">
                  {r.quick ? "⚡ Quick play" : `${r.host ?? "Someone"}'s room`}
                </div>
                <div className="text-xs text-parchment/70">
                  {MAP_NAMES[r.map_id] ?? r.map_id} · {r.players}/{r.capacity} players
                </div>
              </div>
              <button className="btn shrink-0 px-3 py-1 text-sm" onClick={() => onJoin(r.code)}>Join</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
