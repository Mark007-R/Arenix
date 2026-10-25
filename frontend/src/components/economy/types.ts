import type { Cosmetics } from "@/game/art/characters";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface ItemDTO {
  id: string;
  name: string;
  kind: "skin" | "hat" | "chat_pack" | "effect";
  rarity: Rarity;
  data: Record<string, unknown>;
  probability?: number;
}

export interface CrateDTO {
  id: string;
  name: string;
  currency: "game_points" | "diamonds";
  price: number;
  available: boolean;
  unavailable_reason: string | null;
  odds_by_rarity: { rarity: Rarity; probability: number }[];
  items: ItemDTO[];
}

export interface Profile {
  user_id: number;
  display_name: string;
  level: number;
  xp: number;
  game_points: number;
  diamonds: number;
  matches_played: number;
  wins: number;
  units_delivered: number;
  shrines_awakened: number;
  achievements: { id: string; name: string; description: string }[];
  equipped: Record<string, string | null>;
  adult_confirmed: boolean;
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#c4c9d2",
  uncommon: "#86d35f",
  rare: "#6aa8ee",
  epic: "#d8a6ff",
  legendary: "#f4c542",
};

export const CURRENCY_LABEL = { game_points: "Game Points", diamonds: "Diamonds" } as const;
export const CURRENCY_ICON = { game_points: "🪙", diamonds: "💎" } as const;

/** Cosmetics preview for a single item (what it would look like equipped alone). */
export function previewCosmetics(item: ItemDTO): Cosmetics {
  if (item.kind === "skin") return { skin: { id: item.id, ...(item.data as { tunic: string; tunicDark: string; accent: string }) } };
  if (item.kind === "hat") return { hat: { id: item.id, style: String(item.data.style) } };
  return {};
}

export function pct(p: number): string {
  const v = p * 100;
  return v >= 1 ? `${v.toFixed(1)}%` : `${v.toFixed(2)}%`;
}
