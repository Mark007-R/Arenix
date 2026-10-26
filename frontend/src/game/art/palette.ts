/** The ARENIX palette: warm, saturated fantasy colours with a single deep outline tone. */
const SUMMER = {
  outline: "#1f1630",
  shadow: "rgba(20,12,30,0.35)",

  grass: "#5dae47",
  grassDark: "#4a9a3c",
  grassLight: "#7cc95a",
  forest: "#3f8a3e",
  forestDark: "#317333",
  forestLight: "#55a24a",
  leaf: "#2f7d3a",
  leafDark: "#1f5b2e",
  leafLight: "#4fae4a",
  leafHi: "#86d35f",
  trunk: "#6b4026",

  sand: "#ead398",
  sandDark: "#d6ba7a",
  water: "#3b7fd6",
  waterDark: "#2f68b8",
  waterLight: "#6aa8ee",
  foam: "#d9f0ff",

  path: "#cfaa72",
  pathDark: "#ae8a56",
  pathLight: "#e3c48e",
  dirt: "#8f6844",
  dirtDark: "#76543a",
  dirtLight: "#a77d55",

  plank: "#a8703f",
  plankDark: "#7c4e2a",
  plankLight: "#c58d55",

  stone: "#9aa0ad",
  stoneDark: "#6e7482",
  stoneLight: "#c4c9d2",
  rock: "#8a7b6c",
  rockDark: "#665a4f",
  rockLight: "#ab9c8a",
  floor: "#b8b2a8",
  floorDark: "#9a9389",

  roofRed: "#c8483c",
  roofBlue: "#3f6fbf",
  roofGreen: "#4f9a4a",
  wallCream: "#f0dfb8",
  wallCreamDark: "#d4bf92",
  wood: "#8a5a32",
  gold: "#f4c542",
  goldDark: "#c9952a",
  crystal: "#a77bf2",
  crystalLight: "#d8c2ff",
  red: "#d6453b",
  white: "#fbf7ee",
  black: "#2a2236",
  flowerPink: "#f08bb4",
  flowerYellow: "#ffe066",
  flowerWhite: "#fff7e8",
};

export type Palette = Record<keyof typeof SUMMER, string>;

/** Frostpeak Isle: grass becomes snow, water turns icy, leaves are dark pine. */
const WINTER: Partial<Palette> = {
  grass: "#e8eef7",
  grassDark: "#cfd9e8",
  grassLight: "#ffffff",
  forest: "#d5e0ee",
  forestDark: "#b9c7da",
  forestLight: "#edf3fb",
  leaf: "#2e5e4e",
  leafDark: "#1f4439",
  leafLight: "#4b7f6b",
  leafHi: "#dbe7f2",
  sand: "#c9d3df",
  sandDark: "#aab6c6",
  water: "#4f8fc4",
  waterDark: "#3a74a6",
  waterLight: "#8fc3e8",
  foam: "#f2fbff",
  path: "#b3a395",
  pathDark: "#94857a",
  pathLight: "#cdbfb2",
  dirt: "#7d6a5c",
  dirtDark: "#64554a",
  dirtLight: "#95826f",
  flowerPink: "#a9d8ff",
  flowerYellow: "#e0f2ff",
  flowerWhite: "#ffffff",
};

const THEMES: Record<string, Partial<Palette>> = { summer: {}, winter: WINTER };

/** Colours for a map theme, without touching the live palette. */
export function themed(theme?: string): Palette {
  return { ...SUMMER, ...(THEMES[theme ?? "summer"] ?? {}) };
}

/** The live palette the art builders draw with; `applyTheme` switches it before a map is drawn. */
export const P: Palette = { ...SUMMER };

export function applyTheme(theme?: string): void {
  Object.assign(P, themed(theme));
}
