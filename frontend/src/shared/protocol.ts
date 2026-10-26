/** Wire types mirroring backend/arenix/server (welcome/snapshot) and engine payloads. */

import type { Cosmetics } from "@/game/art/characters";

export type Facing = "up" | "down" | "left" | "right";
export type Resource = "wood" | "stone";

export interface MapObjectDTO {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  interactable: boolean;
  props: Record<string, unknown>;
}

export interface RegionDTO {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapDTO {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: number[];
  collision: string;
  objects: MapObjectDTO[];
  spawns: [number, number][];
  regions: RegionDTO[];
  /** "summer" (default) or "winter". */
  theme?: string;
}

export interface ContestantDTO {
  id: string;
  name: string;
  archetype: string;
  is_bot: boolean;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  carrying: Record<Resource, number>;
  /** null while an impostor match is running (other players' scores would give roles away). */
  score: number | null;
  alive: boolean;
  connected: boolean;
  cosmetics?: Cosmetics;
}

export interface RosterEntry {
  id: string;
  name: string;
  archetype: string;
  is_bot: boolean;
  score: number | null;
  alive: boolean;
  connected: boolean;
  cosmetics?: Cosmetics;
}

export interface ObjectiveDTO {
  kind: string;
  amount: number;
  target: string | null;
  text: string;
}

export type Phase = "explore" | "discuss" | "vote" | "reveal";
export type GameMode = "classic" | "impostor";
export type Role = "islander" | "impostor" | "sheriff" | "jester";
export type Team = "islander" | "impostor" | "jester";

export interface SkillDTO {
  id: "swift" | "scout" | "strongback" | "detective" | "medic" | "lookout";
  name: string;
  text: string;
}

export interface BodyDTO {
  id: string;
  victim: string;
  x: number;
  y: number;
}

export interface MissionDTO {
  id: string;
  title: string;
  target_id: string;
  required: Record<Resource, number>;
  delivered: Record<Resource, number>;
  contributions: Record<string, number>;
  status: "active" | "completed" | "failed";
}

export interface GameEventDTO {
  seq: number;
  tick: number;
  type: string;
  data: Record<string, unknown>;
  /** Present when only some contestants can see this event. */
  private?: boolean;
}

export interface SnapshotDTO {
  tick: number;
  status: "lobby" | "running" | "finished";
  time_left: number;
  phase: Phase;
  phase_left: number;
  meeting: number;
  /** Only contestants this player can currently see (server-filtered). */
  contestants: ContestantDTO[];
  /** Public info about everyone. */
  roster: RosterEntry[];
  nodes: Record<string, number>;
  mission: MissionDTO;
  shrine: { status: "dormant" | "channeling" | "activated"; count: number; required: number; window_left: number };
  voted: string[];
  mode?: GameMode;
  /** Impostor mode: which beacons are lit (public). */
  beacons?: Record<string, boolean>;
  /** Impostor mode: bodies this player can currently see. */
  bodies?: BodyDTO[];
  me?: {
    ally: string | null;
    incoming_proposals: string[];
    outgoing_proposals: string[];
    objective: ObjectiveDTO | null;
    bell_used: boolean;
    vote: string | null;
    delivered: Record<Resource, number>;
    phrases?: Record<string, string>;
    /** True state of the player (a killed player is a ghost even before others know). */
    alive?: boolean;
    capacity?: number;
    role?: Role;
    fellow_impostors?: string[];
    skill?: SkillDTO | null;
    ability_used?: boolean;
    speed?: number;
    /** Seconds until the impostor may kill again (null for islanders). */
    kill_cooldown?: number | null;
    /** Impostors: seconds until the next sabotage. */
    sabotage_cooldown?: number | null;
    /** Sheriff: the single bullet has been fired. */
    bullet_used?: boolean | null;
  };
  /** Impostor mode: seconds of fog left (islanders see less). */
  fog_left?: number;
}

export interface Constants {
  tick_rate: number;
  speed: number;
  half_w: number;
  half_h: number;
  interact_range: number;
  kill_range?: number;
  shoot_range?: number;
  report_range?: number;
}

export interface WelcomeMsg {
  type: "welcome";
  you: string;
  /** Last input sequence the server has for us; a reconnecting client continues after it. */
  resume_seq: number;
  match_id: string;
  map: MapDTO;
  constants: Constants;
  snapshot: SnapshotDTO;
}

export interface SnapshotMsg extends SnapshotDTO {
  type: "snapshot";
  ack_seq: number;
  events: GameEventDTO[];
}

export interface InteractResultMsg {
  type: "interact_result";
  target_id: string;
  ok: boolean;
  reason: string;
}

export interface PongMsg {
  type: "pong";
  t: number;
}

export interface SeatDTO {
  player_id: string;
  name: string;
  archetype: string;
  ready: boolean;
  connected: boolean;
  is_host: boolean;
  cosmetics?: Cosmetics;
}

export interface LobbyMsg {
  type: "lobby";
  code: string;
  status: "lobby" | "running";
  practice: boolean;
  fill_to: number;
  capacity: number;
  map_id: string;
  /** Impostor mode: map choices for the host ("random" or a map id). */
  maps?: string[];
  mode?: GameMode;
  min_contestants?: number;
  seats: SeatDTO[];
  can_start: boolean;
  /** Listed in the public room browser. */
  public?: boolean;
  /** Quick-play room: starts on its own. */
  quick?: boolean;
  /** Quick play: seconds until the match starts itself (null when not counting down). */
  auto_start_in?: number | null;
  last_result: MatchResult | null;
  ai_mode: "rules" | "heuristic" | "anthropic";
}

export interface ErrorMsg {
  type: "error";
  code: string;
  message: string;
}

export interface RewardsMsg {
  type: "rewards";
  match_id: string;
  game_points: number;
  xp: number;
  level: number;
  achievements: { id: string; name: string; game_points: number; diamonds: number }[];
  balance: { game_points: number; diamonds: number };
}

export interface ReportAckMsg {
  type: "report_ack";
  target: string;
}

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | InteractResultMsg
  | PongMsg
  | LobbyMsg
  | ErrorMsg
  | RewardsMsg
  | ReportAckMsg;

export type ClientMsg =
  | { type: "input"; seq: number; dx: number; dy: number }
  | { type: "interact"; target_id: string }
  | { type: "ping"; t: number }
  | { type: "ready"; ready: boolean }
  | { type: "set_archetype"; archetype: string }
  | { type: "set_fill"; fill_to: number }
  | { type: "start" }
  | { type: "chat"; text?: string; quick?: string; to?: string | null }
  | { type: "vote"; target: string | null }
  | { type: "propose"; target: string }
  | { type: "respond"; proposer: string; accept: boolean }
  | { type: "break_alliance" }
  | { type: "kill"; target: string }
  | { type: "shoot"; target: string }
  | { type: "sabotage"; kind: "fog" | "douse" }
  | { type: "set_map"; map_id: string }
  | { type: "set_public"; public: boolean }
  | { type: "ability"; target: string | null }
  | { type: "report"; target: string; reason: string; note: string | null };

export interface SeatGrant {
  code: string;
  player_id: string;
  token: string;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  alive: boolean;
  contributed: number;
  bonuses: Record<string, number>;
  objective: ObjectiveDTO | null;
  objective_achieved: boolean;
  /** Impostor mode: revealed when the match ends. */
  won?: boolean;
  role?: Role;
  skill?: SkillDTO | null;
}

export interface MatchResult {
  reason: "time_up" | "final_two" | "impostors_caught" | "impostors_outnumber" | "tasks_done";
  winner: string | null;
  tower_repaired: boolean;
  shrine_activated: boolean;
  standings: Standing[];
  mode?: GameMode;
  winning_team?: Team;
  winners?: string[];
  beacons_lit?: number;
  beacons_total?: number;
}

/** Mirror of backend QUICK_CHAT (free base pack). */
export const QUICK_CHAT: Record<string, string> = {
  trust_me: "Trust me, I have a plan!",
  alliance: "Alliance?",
  suspicious: "That was suspicious.",
  saw_nothing: "I saw nothing!",
  meet_castle: "Meet me near the castle.",
  never_friends: "We were never friends.",
  betrayal: "The betrayal is crazy.",
  vote_wisely: "Vote wisely.",
  well_played: "Well played!",
  gg: "GG, everyone!",
  need_stone: "We need more stone.",
  need_wood: "We need more wood.",
  protect: "I will protect the team.",
  promised: "You promised!",
  who_trust: "Who can we trust?",
  mission_complete: "Mission complete!",
  shrine_help: "Help me at the shrine!",
};
