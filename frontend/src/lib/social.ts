import { api } from "./account";

export type Board = "wins" | "level" | "win_rate";

export interface LeaderboardEntry {
  rank: number;
  user_id: number;
  display_name: string;
  level: number;
  wins: number;
  matches_played: number;
  win_rate: number;
}

export interface Leaderboard {
  by: Board;
  min_matches: number;
  entries: LeaderboardEntry[];
}

export interface PublicProfile {
  user_id: number;
  display_name: string;
  joined: string;
  level: number;
  xp: number;
  matches_played: number;
  wins: number;
  win_rate: number;
  units_delivered: number;
  achievements: { id: string; name: string; description: string }[];
  recent_matches: { map_id: string; finished_at: string; mode: string; role: string | null; won: boolean; score: number }[];
}

export function getLeaderboard(by: Board): Promise<Leaderboard> {
  return api<Leaderboard>(`/api/leaderboard?by=${by}`);
}

export function getProfile(userId: number): Promise<PublicProfile> {
  return api<PublicProfile>(`/api/players/${userId}/profile`);
}

export function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export const MAP_NAMES: Record<string, string> = {
  emerald_isle: "Emerald Isle",
  moonfall_isle: "Moonfall Isle",
  frostpeak_isle: "❄️ Frostpeak Isle",
  random: "🎲 Random",
};

export const ROLE_NAMES: Record<string, string> = {
  islander: "Islander",
  impostor: "Impostor",
  sheriff: "Sheriff",
  jester: "Jester",
};
