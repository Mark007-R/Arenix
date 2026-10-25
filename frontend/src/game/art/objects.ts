/** Landmark and prop sprites. Each returns a canvas whose bottom edge sits on the footprint's bottom. */
import { P } from "./palette";
import { Pixels, makeCanvas } from "./pixels";

function toCanvas(p: Pixels): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(p.w, p.h);
  p.drawTo(ctx, 0, 0);
  return c;
}

const ROOFS = [P.roofRed, P.roofBlue, P.roofGreen];
const ROOF_HI = ["#e2675a", "#5f8fdf", "#6fba62"];

export function house(variant: number): HTMLCanvasElement {
  // 3x2 footprint = 48x32; roof rises 18px above → 48x50
  const p = new Pixels(48, 50);
  const roof = ROOFS[variant % ROOFS.length]!;
  p.rect(2, 46, 44, 3, P.shadow);
  // walls
  p.rect(4, 26, 40, 21, P.wallCream);
  p.rect(4, 44, 40, 3, P.wallCreamDark);
  p.vline(4, 26, 46, P.wood);
  p.vline(43, 26, 46, P.wood);
  p.hline(4, 43, 26, P.wood);
  // door
  p.rect(20, 33, 8, 14, P.wood);
  p.rect(21, 34, 6, 13, P.plankDark);
  p.px(25, 40, P.gold);
  // windows
  for (const wx of [8, 33]) {
    p.rect(wx, 31, 7, 6, P.wood);
    p.rect(wx + 1, 32, 5, 4, "#9fd3f2");
    p.px(wx + 1, 32, P.white);
    p.hline(wx, wx + 6, 37, P.plankDark);
  }
  // roof: stacked shingles narrowing upward
  for (let r = 0; r < 26; r++) {
    const inset = Math.floor(r * 0.7);
    const y = 26 - r;
    if (16 - inset < 2) break;
    p.hline(inset, 47 - inset, y, r % 4 === 0 ? P.outline : roof);
  }
  for (let r = 1; r < 24; r += 4) {
    const inset = Math.floor(r * 0.7);
    for (let x = inset + 2; x < 47 - inset; x += 6) p.px(x, 26 - r, ROOF_HI[variant % ROOF_HI.length]!);
  }
  // chimney
  p.rect(34, 6, 5, 9, P.stoneDark);
  p.rect(34, 6, 5, 2, P.stone);
  p.outline(P.outline);
  return toCanvas(p);
}

export function watchtower(repaired: boolean): HTMLCanvasElement {
  // 2x2 footprint = 32x32; tower rises 36px → 32x68
  const p = new Pixels(32, 68);
  p.rect(1, 63, 30, 3, P.shadow);
  if (repaired) {
    p.rect(5, 22, 22, 43, P.stone);
    p.rect(21, 22, 6, 43, P.stoneDark);
    for (let y = 26; y < 64; y += 5) p.hline(5, 26, y, P.stoneDark);
    p.rect(13, 50, 6, 15, P.plankDark); // door
    p.rect(14, 32, 4, 6, P.outline); // arrow slit window
    p.rect(2, 14, 28, 9, P.stoneLight); // battlement
    for (let x = 2; x < 30; x += 6) p.rect(x, 10, 4, 4, P.stoneLight);
    p.hline(2, 29, 22, P.stoneDark);
    p.vline(16, 0, 10, P.wood); // flag pole
    p.rect(17, 1, 8, 5, P.red);
    p.rect(17, 3, 8, 1, P.gold);
  } else {
    p.rect(5, 40, 22, 25, P.stone);
    p.rect(21, 40, 6, 25, P.stoneDark);
    for (let y = 44; y < 64; y += 5) p.hline(5, 26, y, P.stoneDark);
    // jagged broken top
    for (let x = 5; x < 27; x++) {
      const h = [0, 3, 5, 2, 6, 1, 4, 7, 2, 0, 3, 5, 1, 4, 6, 2, 0, 3, 1, 5, 2, 0][x - 5] ?? 0;
      p.rect(x, 40 - h, 1, h, x > 20 ? P.stoneDark : P.stone);
    }
    p.rect(13, 52, 6, 13, P.outline);
    // scaffolding and rubble
    p.vline(3, 30, 64, P.wood);
    p.vline(28, 34, 64, P.wood);
    p.hline(2, 29, 46, P.plank);
    p.rect(0, 60, 4, 4, P.stoneDark);
    p.rect(27, 61, 4, 3, P.stone);
  }
  p.outline(P.outline);
  return toCanvas(p);
}

export function well(): HTMLCanvasElement {
  const p = new Pixels(32, 30);
  p.rect(2, 26, 28, 3, P.shadow);
  p.rect(6, 16, 20, 11, P.stone);
  p.rect(6, 16, 20, 3, P.stoneLight);
  p.rect(8, 17, 16, 2, P.water);
  for (let x = 6; x < 26; x += 5) p.vline(x, 20, 26, P.stoneDark);
  p.vline(7, 3, 16, P.wood);
  p.vline(24, 3, 16, P.wood);
  p.rect(4, 1, 24, 4, P.roofRed);
  p.hline(4, 27, 4, P.outline);
  p.vline(16, 5, 11, P.black);
  p.rect(14, 11, 5, 4, P.wood);
  p.outline(P.outline);
  return toCanvas(p);
}

export function shrine(): HTMLCanvasElement {
  const p = new Pixels(32, 46);
  p.rect(1, 42, 30, 3, P.shadow);
  p.rect(3, 32, 26, 11, P.stone);
  p.rect(3, 32, 26, 2, P.stoneLight);
  p.rect(6, 36, 20, 1, P.stoneDark);
  p.rect(9, 22, 14, 10, P.stoneDark);
  p.rect(9, 22, 14, 2, P.stone);
  // dormant crystal
  p.rect(13, 4, 6, 18, P.crystal);
  p.rect(14, 2, 4, 2, P.crystal);
  p.rect(15, 0, 2, 2, P.crystalLight);
  p.vline(14, 5, 18, P.crystalLight);
  p.vline(18, 6, 20, "#7b52c7");
  // runes
  for (const rx of [6, 12, 19, 24]) p.px(rx, 39, P.crystalLight);
  p.outline(P.outline);
  return toCanvas(p);
}

export function mineEntrance(): HTMLCanvasElement {
  const p = new Pixels(48, 26);
  p.rect(6, 4, 36, 22, P.black);
  p.rect(10, 8, 28, 18, "#120c1c");
  p.rect(4, 2, 4, 24, P.wood);
  p.rect(40, 2, 4, 24, P.wood);
  p.rect(2, 0, 44, 5, P.plank);
  p.hline(2, 45, 4, P.plankDark);
  // rails
  p.hline(14, 33, 24, P.stoneDark);
  for (let x = 15; x < 34; x += 4) p.vline(x, 23, 25, P.plankDark);
  p.outline(P.outline);
  return toCanvas(p);
}

export function bell(): HTMLCanvasElement {
  const p = new Pixels(32, 36);
  p.rect(2, 32, 28, 3, P.shadow);
  p.rect(4, 4, 3, 30, P.wood);
  p.rect(25, 4, 3, 30, P.wood);
  p.rect(2, 2, 28, 4, P.plank);
  p.hline(2, 29, 5, P.plankDark);
  p.rect(12, 9, 8, 3, P.gold);
  p.rect(11, 12, 10, 8, P.gold);
  p.rect(9, 20, 14, 3, P.gold);
  p.vline(18, 10, 19, P.goldDark);
  p.rect(15, 23, 2, 2, P.goldDark);
  p.vline(16, 6, 8, P.black);
  p.outline(P.outline);
  return toCanvas(p);
}

export function woodNode(depleted: boolean): HTMLCanvasElement {
  const p = new Pixels(16, 20);
  p.offsetY = 4;
  p.rect(1, 13, 14, 2, P.shadow);
  if (depleted) {
    p.rect(4, 9, 8, 5, P.trunk);
    p.ellipse(4, 7, 8, 4, P.plankLight);
    p.px(7, 8, P.plank);
    p.px(8, 9, P.plank);
  } else {
    for (const [lx, ly] of [[1, 9], [8, 9], [4, 5]] as const) {
      p.rect(lx, ly, 7, 4, P.trunk);
      p.ellipse(lx + 5, ly, 3, 4, P.plankLight);
      p.px(lx + 6, ly + 1, P.plank);
      p.hline(lx, lx + 4, ly, "#8a5a32");
    }
    p.px(3, 4, P.leafLight); // a leafy twig
    p.px(2, 3, P.leafLight);
  }
  p.outline(P.outline);
  return toCanvas(p);
}

export function stoneNode(depleted: boolean): HTMLCanvasElement {
  const p = new Pixels(16, 20);
  p.offsetY = 4;
  p.rect(1, 13, 14, 2, P.shadow);
  if (depleted) {
    p.ellipse(2, 10, 5, 4, P.stoneDark);
    p.ellipse(8, 11, 6, 3, P.stone);
  } else {
    p.ellipse(1, 2, 14, 12, P.stone);
    p.ellipse(3, 3, 7, 5, P.stoneLight);
    p.ellipse(8, 8, 7, 5, P.stoneDark);
    p.px(6, 9, P.gold);
    p.px(10, 5, P.white);
  }
  p.outline(P.outline);
  return toCanvas(p);
}

export function shadow(): HTMLCanvasElement {
  const p = new Pixels(12, 4);
  p.ellipse(0, 0, 12, 4, P.shadow);
  return toCanvas(p);
}

export function arrow(): HTMLCanvasElement {
  const p = new Pixels(9, 8);
  p.rect(3, 0, 3, 3, P.gold);
  p.hline(1, 7, 3, P.gold);
  p.hline(2, 6, 4, P.gold);
  p.hline(3, 5, 5, P.goldDark);
  p.px(4, 6, P.goldDark);
  p.outline(P.outline);
  return toCanvas(p);
}

export function resourceIcon(kind: "wood" | "stone"): HTMLCanvasElement {
  const p = new Pixels(10, 10);
  if (kind === "wood") {
    p.rect(1, 3, 8, 4, P.trunk);
    p.ellipse(6, 2, 3, 5, P.plankLight);
    p.hline(1, 6, 3, "#8a5a32");
  } else {
    p.ellipse(1, 1, 8, 8, P.stone);
    p.ellipse(2, 2, 4, 3, P.stoneLight);
  }
  p.outline(P.outline);
  return toCanvas(p);
}
