"use client";

import Link from "next/link";
import { useHud, type HudStore } from "@/lib/store";

export function ConnectionOverlay({ store, onRetry, connectingText = "Sailing to Emerald Isle…" }: {
  store: HudStore;
  onRetry: () => void;
  connectingText?: string;
}) {
  const connection = useHud(store, (s) => s.connection);
  const error = useHud(store, (s) => s.error);
  if (connection === "connecting" || connection === "idle" || connection === "reconnecting") {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/70">
        <div className="panel px-6 py-4 text-lg" role="status">
          {connection === "reconnecting" ? "Connection dropped — reconnecting…" : connectingText}
        </div>
      </div>
    );
  }
  if (connection !== "error") return null;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/80 p-4">
      <div className="panel max-w-md p-6 text-center" role="alert">
        <h2 className="text-2xl font-bold text-ember">Connection problem</h2>
        <p className="mt-2 text-parchment/85">{error}</p>
        <p className="mt-2 text-xs text-parchment/50">
          Is the game server running? <code>cd backend &amp;&amp; uv run uvicorn arenix.server.app:app</code>
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button className="btn" onClick={onRetry}>Retry</button>
          <Link className="btn btn-ghost" href="/">Main menu</Link>
        </div>
      </div>
    </div>
  );
}
