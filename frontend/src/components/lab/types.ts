import type { GameEventDTO, ObjectiveDTO } from "@/shared/protocol";

export interface LabEvent extends GameEventDTO {
  phase_id: string;
  visible_to?: string[];
}

export interface LabContestant {
  id: string;
  name: string;
  archetype: string;
  is_bot: boolean;
  score: number;
  alive: boolean;
  objective: ObjectiveDTO | null;
}

export interface LabEdge {
  type: string;
  source: string;
  target: string;
  count: number;
  seqs: number[];
}

export interface LabDecision {
  id: number;
  agent: string;
  trigger: string;
  phase_id: string;
  tick_requested: number;
  tick_resolved: number | null;
  status: string;
  context: Record<string, unknown> | null;
  decision: { summary: string; goal: string; shrine_meet_in_s: number | null; actions: Record<string, unknown>[] } | null;
  actions: { proposed: Record<string, unknown>; prevalidated: boolean; reason: string }[];
  engine_results: { tick: number; action: unknown[]; ok: boolean; reason: string }[];
  provider: string;
  model: string;
  is_llm: boolean;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  error: string | null;
}

export interface LabPayload {
  match_id: string;
  room_code: string | null;
  status: string;
  map_id: string;
  seed: number;
  ticks: number;
  full_record: boolean;
  visibility_note: string | null;
  decisions_note: string;
  contestants: LabContestant[];
  events: LabEvent[];
  graph: { edge_types: string[]; edges: LabEdge[] };
  decisions: LabDecision[];
  agent_summary: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

export const EDGE_STYLE: Record<string, { color: string; dash?: string; label: string }> = {
  message: { color: "#6aa8ee", label: "Private messages" },
  alliance_proposed: { color: "#f4c542", dash: "4 3", label: "Alliance offers" },
  alliance_formed: { color: "#86d35f", label: "Alliances formed" },
  alliance_rejected: { color: "#c4c9d2", dash: "2 3", label: "Offers rejected" },
  alliance_broken: { color: "#d6453b", label: "Alliances broken" },
  vote: { color: "#ff9a3c", label: "Votes" },
  shrine: { color: "#d8a6ff", dash: "1 2", label: "Shrine together" },
};
