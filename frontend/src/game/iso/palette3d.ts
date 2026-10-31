/**
 * Muted "drafting table" palette for the 3D view: warm paper, greys, olive and brick.
 * The same colours drive the minimap and map previews, so every view of the island matches.
 */

export interface IsoPalette {
  paper: string;
  grid: string;
  ink: string;
  floor: Record<number, string>; // tile type -> ground colour
  wall: string;
  wallTop: string;
  rock: string;
  ruin: string;
  canopy: string[];
  trunk: string;
  brick: string;
  brickDark: string;
  roof: string;
  wood: string;
  stone: string;
  gold: string;
  fire: string;
  crystal: string;
}

// Tile ids (see backend arenix/engine/tiles.py).
export const TILE = {
  WATER: 0, SAND: 1, GRASS: 2, PATH: 3, BRIDGE: 4, TREE: 5, WALL: 6, ROCK: 7, FLOOR: 8, FLOWERS: 9,
  FOREST_FLOOR: 10, DIRT: 11, RUIN: 12,
} as const;

const SUMMER: IsoPalette = {
  paper: "#ece6d6",
  grid: "#d9d1bd",
  ink: "#3a3630",
  floor: {
    [TILE.WATER]: "#a9bcbd",
    [TILE.SAND]: "#e9dfc4",
    [TILE.GRASS]: "#d3d3b4",
    [TILE.PATH]: "#efe8d6",
    [TILE.BRIDGE]: "#a98a76",
    [TILE.TREE]: "#c3c6a3",
    [TILE.WALL]: "#b9b3a6",
    [TILE.ROCK]: "#c6c0b2",
    [TILE.FLOOR]: "#f2ecdd",
    [TILE.FLOWERS]: "#cfd2ae",
    [TILE.FOREST_FLOOR]: "#c3c6a3",
    [TILE.DIRT]: "#d6c7ad",
    [TILE.RUIN]: "#d8d1c2",
  },
  wall: "#a7a196",
  wallTop: "#c9c3b6",
  rock: "#9b958a",
  ruin: "#bdb6a7",
  canopy: ["#7b8657", "#6f7b4e", "#86915f", "#748050"],
  trunk: "#6e5a4c",
  brick: "#9c7468",
  brickDark: "#7f5c52",
  roof: "#8a6a5e",
  wood: "#8c6a52",
  stone: "#b3ada0",
  gold: "#c99a3a",
  fire: "#e9894a",
  crystal: "#9d8cc4",
};

const WINTER: IsoPalette = {
  ...SUMMER,
  paper: "#e9ecef",
  grid: "#d5dbe1",
  floor: {
    ...SUMMER.floor,
    [TILE.WATER]: "#9fb6c6",
    [TILE.SAND]: "#dfe4ea",
    [TILE.GRASS]: "#f1f3f6",
    [TILE.TREE]: "#e3e8ee",
    [TILE.FLOWERS]: "#eef1f5",
    [TILE.FOREST_FLOOR]: "#e3e8ee",
    [TILE.DIRT]: "#d4ccc4",
    [TILE.PATH]: "#d9d2c9",
  },
  canopy: ["#4f6b5e", "#45604f", "#5a7768", "#4a6457"],
  rock: "#8f949b",
  wall: "#a3a6ab",
  wallTop: "#cfd3d9",
};

export function isoPalette(theme?: string): IsoPalette {
  return theme === "winter" ? WINTER : SUMMER;
}

/** Ground colour per tile type, for minimaps and previews. */
export function groundColors(theme?: string): Record<number, string> {
  const p = isoPalette(theme);
  return {
    ...p.floor,
    [TILE.TREE]: p.canopy[0]!,
    [TILE.WALL]: p.wall,
    [TILE.ROCK]: p.rock,
    [TILE.RUIN]: p.ruin,
  };
}

/** Archetype colours, muted to sit in the drafting palette. */
export const OUTFITS: Record<string, { suit: string; vest: string; accent: string; head: string }> = {
  warrior: { suit: "#b8b3a6", vest: "#8c6a52", accent: "#a5543f", head: "wild" },
  archer: { suit: "#b8b8a4", vest: "#5f7a46", accent: "#8c6a52", head: "hood" },
  wizard: { suit: "#b4b6bd", vest: "#56688f", accent: "#c99a3a", head: "wizard" },
  rogue: { suit: "#a9a6ad", vest: "#5d4f6b", accent: "#8f949b", head: "hoodMask" },
  guardian: { suit: "#b6b8a0", vest: "#6c7a45", accent: "#93a865", head: "leaf" },
  knight: { suit: "#b9bcc0", vest: "#5f6f8a", accent: "#a5543f", head: "helm" },
  trickster: { suit: "#b8b09c", vest: "#8a6d4a", accent: "#7f9a52", head: "goblin" },
  champion: { suit: "#c0b8a6", vest: "#9c5a4c", accent: "#c99a3a", head: "crown" },
};
