/** Playable archetypes (cosmetic only: every contestant plays the same) and cosmetic loadouts. */

/** Server-validated cosmetic loadout (see backend economy catalog). */
export interface Cosmetics {
  skin?: { id: string; tunic: string; tunicDark: string; accent: string };
  hat?: { id: string; style: string };
  effect?: { id: string; color: string; glyph: string };
}

export function cosmeticKey(archetype: string, c?: Cosmetics): string {
  return `${archetype}~${c?.skin?.id ?? "base"}~${c?.hat?.id ?? "none"}`;
}

/** Portrait size in "frames" (scale multiplies these into pixels). */
export const FRAME = 16;
export const FRAME_H = 20;

export const ARCHETYPES: Record<string, { label: string; blurb: string }> = {
  warrior: { label: "Warrior", blurb: "Loud, fearless, carries an axe for 'diplomacy'." },
  archer: { label: "Archer", blurb: "Sharp eyes. Sharper opinions about your plan." },
  wizard: { label: "Wizard", blurb: "Knows a spell for everything except trust." },
  rogue: { label: "Rogue", blurb: "Was definitely somewhere else at the time." },
  guardian: { label: "Forest Guardian", blurb: "Speaks for the trees. The trees are suspicious." },
  knight: { label: "Knight", blurb: "Sworn to honour. Mostly." },
  trickster: { label: "Trickster", blurb: "A goblin-ish menace with a heart of fool's gold." },
  champion: { label: "Royal Champion", blurb: "Born to win. Will remind you constantly." },
};
