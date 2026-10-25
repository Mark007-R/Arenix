/**
 * Original chibi fantasy characters, drawn procedurally per archetype.
 * Each archetype yields 9 frames: {down, up, side} x {idle, walkA, walkB}. Left = flipped side.
 */
import { P } from "./palette";
import { Pixels, makeCanvas } from "./pixels";

export type Dir = "down" | "up" | "side";
export const DIRS: Dir[] = ["down", "up", "side"];
export const FRAME = 16;
export const FRAME_H = 20;
const HEAD_ROOM = 4;

interface Look {
  skin: string;
  hair: string;
  tunic: string;
  tunicDark: string;
  accent: string;
  boots: string;
  style: "wild" | "hood" | "hoodMask" | "wizard" | "leaf" | "helm" | "goblin" | "crown";
}

export const ARCHETYPES: Record<string, { label: string; blurb: string; look: Look }> = {
  warrior: {
    label: "Warrior",
    blurb: "Loud, fearless, carries an axe for 'diplomacy'.",
    look: { skin: "#e8b48a", hair: "#e0782f", tunic: "#8a5a32", tunicDark: "#6b4026", accent: "#d6453b", boots: "#4a3020", style: "wild" },
  },
  archer: {
    label: "Archer",
    blurb: "Sharp eyes. Sharper opinions about your plan.",
    look: { skin: "#f1c6a0", hair: "#6b4026", tunic: "#3f8f4a", tunicDark: "#2f6e38", accent: "#c58d55", boots: "#5a3a22", style: "hood" },
  },
  wizard: {
    label: "Wizard",
    blurb: "Knows a spell for everything except trust.",
    look: { skin: "#f1c6a0", hair: "#e8e4f0", tunic: "#3f5fbf", tunicDark: "#2f478f", accent: "#f4c542", boots: "#2f2a4a", style: "wizard" },
  },
  rogue: {
    label: "Rogue",
    blurb: "Was definitely somewhere else at the time.",
    look: { skin: "#d9a07a", hair: "#2a2236", tunic: "#5b3f7a", tunicDark: "#43305c", accent: "#9aa0ad", boots: "#2a2236", style: "hoodMask" },
  },
  guardian: {
    label: "Forest Guardian",
    blurb: "Speaks for the trees. The trees are suspicious.",
    look: { skin: "#c98f62", hair: "#5a3a22", tunic: "#6b7f3a", tunicDark: "#53622c", accent: "#86d35f", boots: "#4a3020", style: "leaf" },
  },
  knight: {
    label: "Knight",
    blurb: "Sworn to honour. Mostly.",
    look: { skin: "#f1c6a0", hair: "#c4c9d2", tunic: "#3f6fbf", tunicDark: "#2f568f", accent: "#d6453b", boots: "#4a4f5c", style: "helm" },
  },
  trickster: {
    label: "Trickster",
    blurb: "A goblin-ish menace with a heart of fool's gold.",
    look: { skin: "#7cc95a", hair: "#2a2236", tunic: "#a8703f", tunicDark: "#7c4e2a", accent: "#d6453b", boots: "#4a3020", style: "goblin" },
  },
  champion: {
    label: "Royal Champion",
    blurb: "Born to win. Will remind you constantly.",
    look: { skin: "#f1c6a0", hair: "#f4c542", tunic: "#c8483c", tunicDark: "#9a3029", accent: "#f4c542", boots: "#5a2a22", style: "crown" },
  },
};

function drawFrame(look: Look, dir: Dir, frame: number): Pixels {
  const p = new Pixels(FRAME, FRAME_H);
  p.offsetY = HEAD_ROOM;

  // Cape for the champion sits behind everything.
  if (look.style === "crown" && dir !== "down") {
    if (dir === "up") p.rect(4, 9, 8, 6, look.tunicDark);
    else p.rect(3, 9, 3, 5, look.tunicDark);
  }

  // Legs + boots
  if (dir === "side") {
    const spread = frame === 1 ? [5, 9] : frame === 2 ? [7, 7] : [6, 8];
    for (const lx of spread) {
      p.rect(lx, 12, 2, 2, look.tunicDark);
      p.rect(lx, 14, 2, 1, look.boots);
    }
  } else {
    const leftUp = frame === 1 ? 1 : 0;
    const rightUp = frame === 2 ? 1 : 0;
    p.rect(5, 12, 2, 2 - leftUp, look.tunicDark);
    p.rect(5, 14 - leftUp, 2, 1, look.boots);
    p.rect(9, 12, 2, 2 - rightUp, look.tunicDark);
    p.rect(9, 14 - rightUp, 2, 1, look.boots);
  }

  // Torso
  const ty = 8;
  p.rect(5, ty, 6, 4, look.tunic);
  p.vline(10, ty, ty + 3, look.tunicDark);
  p.hline(5, 10, ty + 3, look.accent); // belt / sash

  // Arms
  if (dir === "side") {
    const swing = frame === 1 ? -1 : frame === 2 ? 1 : 0;
    p.rect(7 + swing, ty + 1, 2, 2, look.tunicDark);
    p.px(7 + swing, ty + 3, look.skin);
    p.px(8 + swing, ty + 3, look.skin);
  } else {
    const sl = frame === 1 ? 1 : 0;
    const sr = frame === 2 ? 1 : 0;
    p.rect(4, ty + sl, 1, 3, look.tunic);
    p.px(4, ty + 3 + sl, look.skin);
    p.rect(11, ty + sr, 1, 3, look.tunic);
    p.px(11, ty + 3 + sr, look.skin);
  }

  // Head (8x7, trimmed corners)
  const hy = 1;
  p.rect(4, hy + 1, 8, 5, look.skin);
  p.hline(5, 10, hy, look.skin);
  p.hline(5, 10, hy + 6, look.skin);

  // Hair base
  if (dir === "up") {
    p.rect(4, hy + 1, 8, 5, look.hair);
    p.hline(5, 10, hy, look.hair);
    p.hline(5, 10, hy + 6, look.hair);
  } else {
    p.hline(5, 10, hy, look.hair);
    p.rect(4, hy + 1, 8, 1, look.hair);
    if (dir === "side") p.rect(4, hy + 1, 3, 4, look.hair);
  }

  // Face
  if (dir === "down") {
    p.px(6, hy + 3, P.black);
    p.px(9, hy + 3, P.black);
    p.px(5, hy + 4, "#f29a8a");
    p.px(10, hy + 4, "#f29a8a");
  } else if (dir === "side") {
    p.px(10, hy + 3, P.black);
    p.px(11, hy + 4, look.skin);
  }

  drawHeadgear(p, look, dir, hy);
  p.outline(P.outline);
  return p;
}

function drawHeadgear(p: Pixels, look: Look, dir: Dir, hy: number): void {
  const a = look.accent;
  switch (look.style) {
    case "wild": {
      p.hline(4, 11, hy, look.hair);
      p.px(5, hy - 1, look.hair);
      p.px(8, hy - 1, look.hair);
      p.px(10, hy - 1, look.hair);
      p.hline(4, 11, hy + 2, a); // headband
      if (dir === "up") p.rect(7, hy + 6, 2, 2, look.hair); // braid
      break;
    }
    case "hood":
    case "hoodMask": {
      const hood = look.tunicDark;
      p.hline(5, 10, hy - 1, hood);
      p.rect(4, hy, 8, 2, hood);
      if (dir === "up") p.rect(4, hy, 8, 7, hood);
      else if (dir === "down") {
        p.vline(4, hy + 2, hy + 5, hood);
        p.vline(11, hy + 2, hy + 5, hood);
      } else p.rect(4, hy + 2, 3, 4, hood);
      if (look.style === "hoodMask" && dir !== "up") {
        const x0 = dir === "side" ? 8 : 5;
        p.hline(x0, 10 + (dir === "side" ? 1 : 0), hy + 5, P.black);
      }
      break;
    }
    case "wizard": {
      const hat = look.tunic;
      p.hline(2, 13, hy + 1, look.tunicDark); // brim
      p.rect(5, hy - 1, 6, 2, hat);
      p.rect(6, hy - 2, 4, 1, hat);
      p.rect(7, hy - 3, 2, 1, hat);
      p.px(9, hy - 4, hat);
      p.px(6, hy - 1, a); // star
      if (dir !== "up") {
        const bx = dir === "side" ? 8 : 5;
        p.rect(bx, hy + 5, dir === "side" ? 4 : 6, 2, look.hair);
        p.px(bx + (dir === "side" ? 2 : 2), hy + 7, look.hair);
        p.px(bx + (dir === "side" ? 2 : 3), hy + 7, look.hair);
      }
      break;
    }
    case "leaf": {
      p.hline(4, 11, hy + 1, "#3f8a3e");
      for (const lx of [4, 6, 9, 11]) p.px(lx, hy, a);
      p.px(7, hy - 1, a);
      break;
    }
    case "helm": {
      const metal = "#c4c9d2";
      const metalDark = "#8a909c";
      p.rect(4, hy, 8, 5, metal);
      p.hline(5, 10, hy - 1, metal);
      p.vline(11, hy, hy + 4, metalDark);
      if (dir === "down") p.hline(5, 10, hy + 3, P.black);
      if (dir === "side") p.hline(8, 11, hy + 3, P.black);
      p.px(7, hy - 2, a);
      p.px(8, hy - 2, a);
      p.px(dir === "side" ? 6 : 8, hy - 3, a);
      break;
    }
    case "goblin": {
      if (dir !== "up") {
        p.px(3, hy + 2, look.skin);
        p.px(2, hy + 1, look.skin);
        p.px(12, hy + 2, look.skin);
        p.px(13, hy + 1, look.skin);
      } else {
        p.px(3, hy + 2, look.skin);
        p.px(12, hy + 2, look.skin);
      }
      p.rect(5, hy - 1, 6, 2, a);
      p.px(10, hy - 2, a);
      p.px(11, hy - 2, a);
      break;
    }
    case "crown": {
      p.hline(5, 10, hy, P.gold);
      p.px(5, hy - 1, P.gold);
      p.px(7, hy - 1, P.gold);
      p.px(8, hy - 1, P.gold);
      p.px(10, hy - 1, P.gold);
      if (dir !== "up") p.px(7, hy, P.red);
      break;
    }
  }
}

/** Builds a 144x20 strip per archetype; frame index = dirIndex * 3 + frame. */
export function buildCharacterSheet(archetype: string): HTMLCanvasElement {
  const look = (ARCHETYPES[archetype] ?? ARCHETYPES.knight!).look;
  const [canvas, ctx] = makeCanvas(FRAME * 9, FRAME_H);
  DIRS.forEach((dir, d) => {
    for (let f = 0; f < 3; f++) drawFrame(look, dir, f).drawTo(ctx, (d * 3 + f) * FRAME, 0);
  });
  return canvas;
}

/** A single still portrait (front idle) for menus and HUD. */
export function buildPortrait(archetype: string, scale = 4): HTMLCanvasElement {
  const look = (ARCHETYPES[archetype] ?? ARCHETYPES.knight!).look;
  const [canvas, ctx] = makeCanvas(FRAME * scale, FRAME_H * scale);
  const [tmp, tctx] = makeCanvas(FRAME, FRAME_H);
  drawFrame(look, "down", 0).drawTo(tctx, 0, 0);
  ctx.drawImage(tmp, 0, 0, FRAME * scale, FRAME_H * scale);
  return canvas;
}
