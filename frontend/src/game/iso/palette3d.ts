/**
 * Bright "drafting table" palette for the 3D view: warm paper, fresh greens, sky-blue water,
 * coral roofs and sunny accents.
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
  paper: "#f4efe2",
  grid: "#e3d9c2",
  ink: "#2b2a33",
  floor: {
    [TILE.WATER]: "#7cc3e6",
    [TILE.SAND]: "#f6e2a8",
    [TILE.GRASS]: "#b8dc8c",
    [TILE.PATH]: "#f6ead0",
    [TILE.BRIDGE]: "#c98a5e",
    [TILE.TREE]: "#9fcf7c",
    [TILE.WALL]: "#cfc6b4",
    [TILE.ROCK]: "#cbc3b2",
    [TILE.FLOOR]: "#fbf4e4",
    [TILE.FLOWERS]: "#bfe08f",
    [TILE.FOREST_FLOOR]: "#9fcf7c",
    [TILE.DIRT]: "#e6c999",
    [TILE.RUIN]: "#e4dccb",
  },
  wall: "#c7bfae",
  wallTop: "#ddd5c4",
  rock: "#a9a196",
  ruin: "#d2c9b6",
  canopy: ["#5fb04f", "#4a9e47", "#7cc35a", "#3f9150"],
  trunk: "#8a5a3c",
  brick: "#e07a5f",
  brickDark: "#c25e45",
  roof: "#3d7bb6",
  wood: "#a8693f",
  stone: "#c9c1b2",
  gold: "#f2b134",
  fire: "#ff7b39",
  crystal: "#a77bf2",
};

/** House roofs cycle through these (one per house variant). */
export const ROOFS = ["#3d7bb6", "#e0563f", "#3f9a5e"];

const WINTER: IsoPalette = {
  ...SUMMER,
  paper: "#e9ecef",
  grid: "#d5dbe1",
  floor: {
    ...SUMMER.floor,
    [TILE.WATER]: "#8fcdf0",
    [TILE.SAND]: "#e4ecf3",
    [TILE.GRASS]: "#f6f9fc",
    [TILE.TREE]: "#e6eef6",
    [TILE.FLOWERS]: "#f1f6fb",
    [TILE.FOREST_FLOOR]: "#e6eef6",
    [TILE.DIRT]: "#dccfc4",
    [TILE.PATH]: "#d9d2c9",
  },
  canopy: ["#3f8a6e", "#2f7a62", "#4e9e80", "#357f68"],
  rock: "#9aa3ad",
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

/** Archetype colours: bright vests and trims on light suits, so each contestant reads at a glance. */
export const OUTFITS: Record<string, { suit: string; vest: string; accent: string; head: string }> = {
  warrior: { suit: "#dcd6cb", vest: "#c8643c", accent: "#f2b134", head: "wild" },
  archer: { suit: "#dcdacd", vest: "#3f9e4d", accent: "#c8643c", head: "hood" },
  wizard: { suit: "#d8dae2", vest: "#4a6fd1", accent: "#f2b134", head: "wizard" },
  rogue: { suit: "#d2cfd8", vest: "#7b5ba8", accent: "#e05a8a", head: "hoodMask" },
  guardian: { suit: "#dbdcc8", vest: "#6a9e3a", accent: "#b6dc6a", head: "leaf" },
  knight: { suit: "#dcdfe4", vest: "#3d7bb6", accent: "#e05a47", head: "helm" },
  trickster: { suit: "#ddd5c2", vest: "#d08a2e", accent: "#5fb04f", head: "goblin" },
  champion: { suit: "#e2dccd", vest: "#d64545", accent: "#f2b134", head: "crown" },
};
