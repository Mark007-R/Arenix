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
  kill_cooldown: "Your knife isn't ready yet.",
  not_impostor: "Only an impostor can do that.",
  need_wood: "A beacon burns one wood — bring some from the forest.",
  already_lit: "That beacon is already burning.",
  ability_used: "You already used your ability this match.",
  no_active_skill: "Your skill works on its own — nothing to activate.",
  shielded: "A magic shield blocked your attack!",
};

/** "Old Mine" -> "the Old Mine"; "the wilds" stays as it is. */
export function place(region: unknown): string {
  const r = String(region ?? "the wilds");
  return r.startsWith("the ") ? r : `the ${r}`;
}

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
      return d.mode === "impostor"
        ? { text: "The match begins. Someone among you is an impostor…", tone: "info" }
        : { text: "The match begins! Repair the tower, survive the council.", tone: "info" };
    case "role_assigned":
      return d.role === "impostor"
        ? {
            text: `You are the IMPOSTOR${(d.fellow as string[]).length ? ` (with ${(d.fellow as string[]).map(whom).join(", ")})` : ""}. Eliminate islanders without being caught.`,
            tone: "bad",
          }
        : { text: "You are an ISLANDER. Finish the tasks and vote out the impostor.", tone: "good" };
    case "skill_assigned": {
      const sk = d.skill as { name: string; text: string };
      return { text: `Your skill this match: ${sk.name} — ${sk.text}`, tone: "mine" };
    }
    case "contestant_killed":
      if (d.victim === you) return { text: `${who(d.killer)} killed you! You are now a ghost.`, tone: "bad" };
      if (d.killer === you) return { text: `You eliminated ${whom(d.victim)}. Get away before someone finds the body.`, tone: "mine" };
      return { text: `${who(d.killer)} eliminated ${whom(d.victim)}.`, tone: "info" };
    case "kill_witnessed":
      return { text: `You SAW ${who(d.killer)} kill ${whom(d.victim)} in ${place(d.region)}!`, tone: "bad" };
    case "lookout_alert":
      return { text: `Lookout: you sense a death near ${place(d.region)}.`, tone: "bad" };
    case "shield_cast":
      return { text: `You shielded ${whom(d.target)}. It will block one attack.`, tone: "mine" };
    case "shield_blocked":
      if (d.target === you) return { text: `${who(d.attacker)} attacked you — a shield saved you!`, tone: "bad" };
      if (d.attacker === you) return { text: `Your attack on ${whom(d.target)} was blocked by a shield!`, tone: "bad" };
      return { text: `Your shield saved ${whom(d.target)} from ${who(d.attacker)}!`, tone: "mine" };
    case "detective_clue": {
      const [a, b] = d.suspects as [string, string];
      return { text: `Detective clue: the killer is either ${who(a)} or ${who(b)}.`, tone: "mine" };
    }
    case "shrine_vision":
      return { text: `Shrine vision: ${who(d.innocent)} is innocent.`, tone: "mine" };
    case "deaths_revealed":
      return { text: `Dead: ${(d.dead as string[]).map(who).join(", ")}.`, tone: "bad" };
    case "ally_lost":
      return { text: `Your alliance with ${whom(d.ally)} suddenly broke… something happened to them.`, tone: "bad" };
    case "beacon_lit":
      return {
        text: `${who(d.contestant)} lit the beacon at ${place(d.region)} (${String(d.lit)}/${String(d.total)}).`,
        tone: mine ? "mine" : "good",
      };
    case "beacon_faked":
      return { text: "You pretended to tend the beacon. It stays dark.", tone: "mine" };
    case "delivery_faked":
      return { text: "You pretended to deliver. Nothing was added to the tower.", tone: "mine" };
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
        text:
          d.cause === "body"
            ? `${who(d.caller)} found ${whom(d.victim)}'s body in ${place(d.region)}!`
            : d.cause === "bell"
              ? `${who(d.caller)} rang the Council Bell!`
              : "The council convenes.",
        tone: d.cause === "body" ? "bad" : "info",
      };
    case "vote_started":
      return { text: "Voting is open.", tone: "info" };
    case "vote_resolved":
      if (!d.eliminated) return { text: "No one was voted out.", tone: "info" };
      if (d.was_impostor === true)
        return { text: `${who(d.eliminated)} was an impostor! (${String(d.impostors_left)} left)`, tone: "good" };
      if (d.was_impostor === false) return { text: `${who(d.eliminated)} was NOT an impostor.`, tone: "bad" };
      return { text: `The council voted out ${whom(d.eliminated)}.`, tone: d.eliminated === you ? "bad" : "info" };
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
