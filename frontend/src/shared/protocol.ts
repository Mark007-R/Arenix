/** Wire types mirroring backend/arenix/server (welcome/snapshot) and engine payloads. */

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
  score: number;
  connected: boolean;
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
}

export interface SnapshotDTO {
  tick: number;
  status: "lobby" | "running" | "finished";
  time_left: number;
  contestants: ContestantDTO[];
  nodes: Record<string, number>;
  mission: MissionDTO;
}

export interface Constants {
  tick_rate: number;
  speed: number;
  half_w: number;
  half_h: number;
  interact_range: number;
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
}

export interface LobbyMsg {
  type: "lobby";
  code: string;
  status: "lobby" | "running";
  practice: boolean;
  fill_to: number;
  capacity: number;
  map_id: string;
  seats: SeatDTO[];
  can_start: boolean;
  last_result: MatchResult | null;
}

export interface ErrorMsg {
  type: "error";
  code: string;
  message: string;
}

export type ServerMsg = WelcomeMsg | SnapshotMsg | InteractResultMsg | PongMsg | LobbyMsg | ErrorMsg;

export type ClientMsg =
  | { type: "input"; seq: number; dx: number; dy: number }
  | { type: "interact"; target_id: string }
  | { type: "ping"; t: number }
  | { type: "ready"; ready: boolean }
  | { type: "set_archetype"; archetype: string }
  | { type: "set_fill"; fill_to: number }
  | { type: "start" };

export interface SeatGrant {
  code: string;
  player_id: string;
  token: string;
}

export interface MatchResult {
  reason: "mission_completed" | "time_up";
  winner: string | null;
  standings: { id: string; name: string; score: number; contributed: number }[];
}
