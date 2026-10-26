"use client";

import { useEffect } from "react";
import type { GameClient } from "@/game/net/client";
import { audio } from "@/lib/audio";
import type { HudStore } from "@/lib/store";

/** Plays sound effects for game events and switches the music with the phase. */
export function GameAudio({ client, store }: { client: GameClient; store: HudStore }) {
  useEffect(() => {
    const a = audio();
    const off = client.onEvent((ev) => {
      const d = ev.data as Record<string, unknown>;
      const me = client.you;
      switch (ev.type) {
        case "resource_gathered":
          if (d.contestant === me) a.play("gather");
          break;
        case "resources_delivered":
          if (d.contestant === me) a.play("deliver");
          break;
        case "beacon_lit":
          a.play("beacon");
          break;
        case "contestant_killed":
        case "kill_witnessed":
          a.play("kill");
          break;
        case "shield_blocked":
          a.play("shield");
          break;
        case "meeting_called":
          a.play(d.cause === "body" ? "body" : "bell");
          break;
        case "vote_resolved":
          if (d.was_impostor === true) a.play("good");
          else if (d.was_impostor === false) a.play("bad");
          break;
        case "chat":
          if (d.sender !== me && !client.isMuted(String(d.sender))) a.play("chat");
          break;
        case "match_finished": {
          const winners = (d.winners as string[] | undefined) ?? (d.winner ? [String(d.winner)] : []);
          a.play(me && winners.includes(me) ? "win" : "lose");
          break;
        }
      }
    });
    let lastPhase = "";
    const unsub = store.subscribe(() => {
      const s = store.get().snapshot;
      const phase = !s || s.status !== "running" ? "none" : s.phase === "explore" ? "explore" : "meeting";
      if (phase === lastPhase) return;
      lastPhase = phase;
      a.setMood(phase === "none" ? null : phase === "explore" ? "explore" : "meeting");
    });
    return () => {
      off();
      unsub();
      a.setMood(null);
    };
  }, [client, store]);
  return null;
}
