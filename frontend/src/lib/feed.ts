import type { GameEventDTO } from "@/shared/protocol";
import type { FeedItem } from "./store";

const REASONS: Record<string, string> = {
  out_of_range: "Too far away — get closer.",
  cooldown: "Catch your breath…",
  depleted: "Nothing left here. It will regrow soon.",
  inventory_full: "Your pack is full. Deliver to the Watchtower!",
  nothing_to_deliver: "You have nothing to deliver.",
  mission_closed: "The mission is over.",
  match_not_running: "The match is not running.",
  not_interactable: "You can't use that.",
};

export function rejectionText(reason: string): string {
  return REASONS[reason] ?? "That didn't work.";
}

function fmtRes(r: Record<string, number> | undefined): string {
  if (!r) return "";
  return Object.entries(r)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(" + ");
}

/** Turn an authoritative event into a short feed line, or null if it is not feed-worthy. */
export function formatEvent(
  ev: GameEventDTO,
  names: Record<string, string>,
  you: string | null,
): Omit<FeedItem, "id"> | null {
  const d = ev.data;
  const who = (id: unknown) => (id === you ? "You" : (names[String(id)] ?? String(id)));
  const mine = d.contestant === you;
  switch (ev.type) {
    case "match_started":
      return { text: "The match begins! Repair the Watchtower.", tone: "info" };
    case "resource_gathered":
      return mine ? { text: `You gathered 1 ${String(d.resource)}.`, tone: "mine" } : null;
    case "resources_delivered": {
      const acc = fmtRes(d.accepted as Record<string, number>);
      if (!acc) return { text: `${who(d.contestant)} brought materials nobody needed.`, tone: "bad" };
      return { text: `${who(d.contestant)} delivered ${acc} (+${String(d.points)}).`, tone: mine ? "mine" : "good" };
    }
    case "mission_completed":
      return { text: "The Watchtower stands tall again!", tone: "good" };
    case "mission_failed":
      return { text: "Time's up — the Watchtower remains in ruins.", tone: "bad" };
    case "contestant_connection":
      return { text: `${who(d.contestant)} ${d.connected ? "reconnected" : "disconnected"}.`, tone: "info" };
    default:
      return null;
  }
}
