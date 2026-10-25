/** TypeScript port of backend/arenix/engine/replay.py — rebuilds state from the event log only. */
import type { GameEventDTO } from "@/shared/protocol";

export interface ReplayState {
  tick: number;
  seq: number;
  phase: string;
  meeting: number;
  contestants: string[];
  scores: Record<string, number>;
  alive: Record<string, boolean>;
  delivered: Record<string, number>;
  required: Record<string, number>;
  tower_repaired: boolean;
  shrine: string;
  alliances: Record<string, string>;
  positions: Record<string, number[]>;
  last_votes: Record<string, string>;
  finished: boolean;
  winner: string | null;
  beacons: Record<string, boolean>;
  winning_team: string | null;
}

export function initialReplay(): ReplayState {
  return {
    tick: 0, seq: 0, phase: "explore", meeting: 0, contestants: [], scores: {}, alive: {},
    delivered: { wood: 0, stone: 0 }, required: {}, tower_repaired: false, shrine: "dormant",
    alliances: {}, positions: {}, last_votes: {}, finished: false, winner: null, beacons: {}, winning_team: null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- event payloads are heterogeneous JSON */
export function apply(s: ReplayState, ev: GameEventDTO): ReplayState {
  const d = ev.data as any;
  const n: ReplayState = { ...s, tick: ev.tick, seq: ev.seq };
  const add = (id: string, pts: number) => {
    n.scores = { ...n.scores, [id]: (n.scores[id] ?? 0) + Number(pts) };
  };
  switch (ev.type) {
    case "match_started":
      n.contestants = [...d.contestants];
      n.scores = Object.fromEntries(d.contestants.map((c: string) => [c, 0]));
      n.alive = Object.fromEntries(d.contestants.map((c: string) => [c, true]));
      n.required = { ...d.required };
      n.beacons = Object.fromEntries((d.beacons ?? []).map((b: string) => [b, false]));
      break;
    case "resources_delivered":
      add(d.contestant, d.points);
      n.delivered = { ...d.delivered };
      break;
    case "ally_dividend":
      add(d.contestant, d.points);
      break;
    case "mission_completed":
      n.tower_repaired = true;
      for (const id of Object.keys(d.contributions)) add(id, d.bonus);
      break;
    case "shrine_channel":
      n.shrine = "channeling";
      break;
    case "shrine_fizzled":
      n.shrine = "dormant";
      break;
    case "shrine_activated":
      n.shrine = "activated";
      for (const id of d.participants) add(id, d.bonus);
      break;
    case "meeting_called":
      n.phase = "discuss";
      n.meeting = Number(d.meeting);
      break;
    case "vote_started":
      n.phase = "vote";
      break;
    case "vote_resolved":
      n.phase = "reveal";
      n.last_votes = { ...d.votes };
      break;
    case "meeting_ended":
      n.phase = "explore";
      break;
    case "contestant_killed": {
      add(d.killer, d.points);
      n.alive = { ...n.alive, [d.victim]: false };
      const positions = { ...n.positions };
      delete positions[d.victim];
      n.positions = positions;
      const al = { ...n.alliances };
      const partner = al[d.victim];
      delete al[d.victim];
      if (partner) delete al[partner];
      n.alliances = al;
      break;
    }
    case "beacon_lit":
      n.beacons = { ...n.beacons, [d.beacon]: true };
      add(d.contestant, d.points);
      break;
    case "contestant_eliminated": {
      n.alive = { ...n.alive, [d.contestant]: false };
      const positions = { ...n.positions };
      delete positions[d.contestant];
      n.positions = positions;
      const al = { ...n.alliances };
      const partner = al[d.contestant];
      delete al[d.contestant];
      if (partner) delete al[partner];
      n.alliances = al;
      break;
    }
    case "alliance_formed": {
      const [a, b] = d.members as [string, string];
      n.alliances = { ...n.alliances, [a]: b, [b]: a };
      break;
    }
    case "alliance_broken": {
      const al = { ...n.alliances };
      delete al[d.by];
      delete al[d.partner];
      n.alliances = al;
      break;
    }
    case "position_sample":
      n.positions = Object.fromEntries(Object.entries(d.positions as Record<string, number[]>).map(([k, v]) => [k, [...v]]));
      break;
    case "match_finished":
      n.finished = true;
      n.winner = d.winner;
      n.winning_team = d.winning_team ?? null;
      for (const st of d.standings) add(st.id, Object.values(st.bonuses as Record<string, number>).reduce((a, b) => a + b, 0));
      break;
  }
  return n;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function replayTo(events: GameEventDTO[], seq: number): ReplayState {
  let s = initialReplay();
  for (const ev of events) {
    if (ev.seq > seq) break;
    s = apply(s, ev);
  }
  return s;
}
