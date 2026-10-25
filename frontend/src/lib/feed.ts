import type { GameEventDTO } from "@/shared/protocol";
import type { FeedItem } from "./store";

const REASONS: Record<string, string> = {
  out_of_range: "Too far away — get closer.",
  cooldown: "Catch your breath…",
  depleted: "Nothing left here. It will regrow soon.",
  inventory_full: "Your pack is full. Deliver to the Watchtower!",
  nothing_to_deliver: "You have nothing to deliver.",
  mission_closed: "That's already done.",
  match_not_running: "The match is not running.",
  not_interactable: "You can't use that.",
  meeting_in_progress: "The council is in session.",
  eliminated: "You have been voted out — you can only watch now.",
  bell_used: "You already rang the Council Bell this match.",
  already_channeling: "You are already channeling. Get others to join!",
  chat_cooldown: "You're talking too fast.",
  message_rejected: "Message not allowed.",
  unknown_phrase: "Unknown phrase.",
  not_allied: "You can only whisper to your ally.",
  invalid_target: "You can't choose them.",
  already_allied: "One of you is already in an alliance.",
  already_proposed: "You already proposed — wait for an answer.",
  no_proposal: "That offer has expired.",
  already_voted: "You already voted.",
  wrong_phase: "Not now.",
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
  const whom = (id: unknown) => (id === you ? "you" : (names[String(id)] ?? String(id)));
  const mine = d.contestant === you;
  switch (ev.type) {
    case "match_started":
      return { text: "The match begins! Repair the tower, survive the council.", tone: "info" };
    case "objective_assigned":
      return { text: `Secret objective: ${(d.objective as { text: string }).text}`, tone: "mine" };
    case "resource_gathered":
      return mine ? { text: `You gathered 1 ${String(d.resource)}.`, tone: "mine" } : null;
    case "resources_delivered": {
      const acc = fmtRes(d.accepted as Record<string, number>);
      if (!acc) return { text: `${who(d.contestant)} brought materials nobody needed.`, tone: "bad" };
      return { text: `${who(d.contestant)} delivered ${acc} (+${String(d.points)}).`, tone: mine ? "mine" : "good" };
    }
    case "ally_dividend":
      return d.contestant === you ? { text: `Ally bonus +${String(d.points)} from ${whom(d.source)}.`, tone: "mine" } : null;
    case "mission_completed":
      return { text: "The Watchtower stands tall again!", tone: "good" };
    case "shrine_channel":
      return { text: `${who(d.contestant)} channel${d.contestant === you ? "" : "s"} at the shrine (${String(d.count)}/${String(d.required)}).`, tone: "info" };
    case "shrine_activated":
      return { text: "The Ancient Shrine awakens!", tone: "good" };
    case "shrine_fizzled":
      return { text: "The shrine's glow fades — not enough help arrived.", tone: "bad" };
    case "meeting_called":
      return {
        text: d.cause === "bell" ? `${who(d.caller)} rang the Council Bell!` : "The council convenes.",
        tone: "info",
      };
    case "vote_started":
      return { text: "Voting is open.", tone: "info" };
    case "vote_resolved":
      return d.eliminated
        ? { text: `The council voted out ${whom(d.eliminated)}.`, tone: d.eliminated === you ? "bad" : "info" }
        : { text: "No one was voted out.", tone: "info" };
    case "alliance_proposed":
      return d.proposer === you
        ? { text: `You offered ${whom(d.target)} an alliance.`, tone: "mine" }
        : { text: `${who(d.proposer)} offers you an alliance.`, tone: "mine" };
    case "alliance_formed": {
      const other = (d.members as string[]).find((m) => m !== you);
      return { text: `You are now allied with ${whom(other)}.`, tone: "good" };
    }
    case "alliance_rejected":
      return d.target === you
        ? { text: `You declined ${whom(d.proposer)}'s alliance.`, tone: "info" }
        : { text: `${who(d.target)} declined your alliance.`, tone: "bad" };
    case "alliance_expired":
      return { text: "An alliance offer expired.", tone: "info" };
    case "alliance_broken":
      return {
        text: d.reason === "betrayal"
          ? `${who(d.by)} betrayed ${whom(d.partner)} in the vote!`
          : `${who(d.by)} broke the alliance with ${whom(d.partner)}.`,
        tone: d.partner === you ? "bad" : "info",
      };
    case "contestant_connection":
      return { text: `${who(d.contestant)} ${d.connected ? "reconnected" : "disconnected"}.`, tone: "info" };
    default:
      return null;
  }
}
