/** Renders the whole tile layer into one canvas (one draw call per frame in Phaser). */
import type { MapDTO } from "@/shared/protocol";
import { P } from "./palette";
import { hash2, makeCanvas } from "./pixels";

export const TILE = 16;

export enum T {
  WATER = 0,
  SAND = 1,
  GRASS = 2,
  PATH = 3,
  BRIDGE = 4,
  TREE = 5,
  WALL = 6,
  ROCK = 7,
  FLOOR = 8,
  FLOWERS = 9,
  FOREST_FLOOR = 10,
  DIRT = 11,
  RUIN = 12,
}

type Ctx = CanvasRenderingContext2D;

function fill(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function speckle(ctx: Ctx, ox: number, oy: number, tx: number, ty: number, colors: string[], n: number, salt: number) {
  for (let i = 0; i < n; i++) {
    const hx = Math.floor(hash2(tx, ty, salt + i * 3) * TILE);
    const hy = Math.floor(hash2(tx, ty, salt + i * 3 + 1) * TILE);
    const c = colors[Math.floor(hash2(tx, ty, salt + i * 3 + 2) * colors.length)]!;
    fill(ctx, ox + hx, oy + hy, 1, 1, c);
  }
}

function grassBase(ctx: Ctx, ox: number, oy: number, tx: number, ty: number, forest: boolean): void {
  fill(ctx, ox, oy, TILE, TILE, forest ? P.forest : P.grass);
  const dark = forest ? P.forestDark : P.grassDark;
  const light = forest ? P.forestLight : P.grassLight;
  // short grass blades: a light pixel above a dark one
  for (let i = 0; i < 4; i++) {
    const bx = Math.floor(hash2(tx, ty, 40 + i) * 14) + 1;
    const by = Math.floor(hash2(tx, ty, 50 + i) * 13) + 2;
    fill(ctx, ox + bx, oy + by, 1, 1, dark);
    fill(ctx, ox + bx, oy + by - 1, 1, 1, light);
  }
  speckle(ctx, ox, oy, tx, ty, [dark], 3, 60);
}

export function renderTiles(map: MapDTO): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(map.width * TILE, map.height * TILE);
  const at = (x: number, y: number): T => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return T.WATER;
    return map.tiles[y * map.width + x] as T;
  };
  const isWater = (x: number, y: number) => at(x, y) === T.WATER;

  // Pass 1: ground
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const ox = tx * TILE;
      const oy = ty * TILE;
      const t = at(tx, ty);
      switch (t) {
        case T.GRASS:
        case T.FLOWERS:
          grassBase(ctx, ox, oy, tx, ty, false);
          if (t === T.FLOWERS) {
            for (let i = 0; i < 3; i++) {
              const fx = Math.floor(hash2(tx, ty, 70 + i) * 12) + 2;
              const fy = Math.floor(hash2(tx, ty, 80 + i) * 12) + 2;
              const c = [P.flowerPink, P.flowerYellow, P.flowerWhite][i % 3]!;
              fill(ctx, ox + fx, oy + fy, 1, 1, c);
              fill(ctx, ox + fx - 1, oy + fy, 1, 1, c);
              fill(ctx, ox + fx, oy + fy - 1, 1, 1, c);
              fill(ctx, ox + fx + 1, oy + fy, 1, 1, c);
              fill(ctx, ox + fx, oy + fy + 1, 1, 1, P.grassDark);
            }
          }
          break;
        case T.FOREST_FLOOR:
        case T.TREE:
          grassBase(ctx, ox, oy, tx, ty, true);
          break;
        case T.SAND:
          fill(ctx, ox, oy, TILE, TILE, P.sand);
          speckle(ctx, ox, oy, tx, ty, [P.sandDark, P.white], 5, 90);
          break;
        case T.PATH: {
          fill(ctx, ox, oy, TILE, TILE, P.path);
          // cobbles: offset rows of rounded stones
          for (let r = 0; r < 4; r++) {
            const off = (r + ty) % 2 === 0 ? 0 : 4;
            for (let c = -1; c < 3; c++) {
              const sx = ox + c * 8 + off;
              const sy = oy + r * 4;
              const lx = Math.max(sx, ox);
              const rx = Math.min(sx + 7, ox + TILE);
              if (rx <= lx) continue;
              fill(ctx, lx, sy + 3, rx - lx, 1, P.pathDark);
              if (sx + 7 < ox + TILE && sx + 7 >= ox) fill(ctx, sx + 7, sy, 1, 4, P.pathDark);
              if (hash2(tx * 4 + c, ty * 4 + r, 5) > 0.6) fill(ctx, lx + 1, sy + 1, Math.min(2, rx - lx - 1), 1, P.pathLight);
            }
          }
          break;
        }
        case T.DIRT:
          fill(ctx, ox, oy, TILE, TILE, P.dirt);
          speckle(ctx, ox, oy, tx, ty, [P.dirtDark, P.dirtLight], 7, 100);
          break;
        case T.FLOOR:
        case T.RUIN: {
          fill(ctx, ox, oy, TILE, TILE, P.floor);
          fill(ctx, ox, oy + 7, TILE, 1, P.floorDark);
          fill(ctx, ox, oy + 15, TILE, 1, P.floorDark);
          fill(ctx, ox + ((ty % 2) * 8 + 3), oy, 1, 7, P.floorDark);
          fill(ctx, ox + ((ty % 2) * 8 + 11) % 16, oy + 8, 1, 7, P.floorDark);
          if (hash2(tx, ty, 110) > 0.7) fill(ctx, ox + 5, oy + 10, 3, 1, P.stoneDark); // crack
          break;
        }
        case T.WATER: {
          fill(ctx, ox, oy, TILE, TILE, P.water);
          for (let i = 0; i < 2; i++) {
            const wx = Math.floor(hash2(tx, ty, 120 + i) * 11) + 1;
            const wy = Math.floor(hash2(tx, ty, 130 + i) * 13) + 1;
            fill(ctx, ox + wx, oy + wy, 4, 1, P.waterLight);
          }
          speckle(ctx, ox, oy, tx, ty, [P.waterDark], 3, 140);
          // shoreline foam where water meets land
          if (!isWater(tx, ty - 1)) {
            fill(ctx, ox, oy, TILE, 2, P.foam);
            fill(ctx, ox, oy + 2, TILE, 1, P.waterLight);
          }
          if (!isWater(tx, ty + 1)) fill(ctx, ox, oy + 15, TILE, 1, P.waterLight);
          if (!isWater(tx - 1, ty)) fill(ctx, ox, oy, 1, TILE, P.foam);
          if (!isWater(tx + 1, ty)) fill(ctx, ox + 15, oy, 1, TILE, P.foam);
          break;
        }
        case T.BRIDGE: {
          const horizontal = !isWater(tx - 1, ty) && !isWater(tx + 1, ty);
          fill(ctx, ox, oy, TILE, TILE, P.water);
          if (horizontal) {
            // travel is east-west across a north-south river: planks run vertically
            for (let i = 0; i < 4; i++) {
              fill(ctx, ox + i * 4, oy, 4, TILE, i % 2 ? P.plank : P.plankLight);
              fill(ctx, ox + i * 4 + 3, oy, 1, TILE, P.plankDark);
            }
          } else {
            for (let i = 0; i < 4; i++) {
              fill(ctx, ox, oy + i * 4, TILE, 4, i % 2 ? P.plank : P.plankLight);
              fill(ctx, ox, oy + i * 4 + 3, TILE, 1, P.plankDark);
            }
          }
          if (at(tx, ty - 1) !== T.BRIDGE && horizontal) fill(ctx, ox, oy, TILE, 2, P.plankDark);
          if (at(tx, ty + 1) !== T.BRIDGE && horizontal) fill(ctx, ox, oy + 14, TILE, 2, P.plankDark);
          break;
        }
        case T.WALL: {
          const front = at(tx, ty + 1) !== T.WALL;
          fill(ctx, ox, oy, TILE, TILE, front ? P.stoneDark : P.stone);
          for (let r = 0; r < 4; r++) {
            const off = r % 2 ? 4 : 0;
            fill(ctx, ox, oy + r * 4 + 3, TILE, 1, front ? P.outline : P.stoneDark);
            fill(ctx, ox + off + 7, oy + r * 4, 1, 3, front ? P.outline : P.stoneDark);
            fill(ctx, ox + off, oy + r * 4, 6, 1, front ? P.stone : P.stoneLight);
          }
          if (at(tx, ty - 1) !== T.WALL) {
            // crenellations on the top edge
            fill(ctx, ox, oy, TILE, 3, P.stoneLight);
            fill(ctx, ox + 3, oy, 3, 2, P.stoneDark);
            fill(ctx, ox + 11, oy, 3, 2, P.stoneDark);
          }
          break;
        }
        case T.ROCK: {
          const front = at(tx, ty + 1) !== T.ROCK;
          fill(ctx, ox, oy, TILE, TILE, front ? P.rockDark : P.rock);
          speckle(ctx, ox, oy, tx, ty, [P.rockLight, P.rockDark], 6, 150);
          if (front) {
            fill(ctx, ox, oy + 12, TILE, 4, P.outline);
            fill(ctx, ox + 4, oy + 4, 1, 8, P.outline);
            fill(ctx, ox + 11, oy + 2, 1, 9, P.outline);
          }
          if (at(tx, ty - 1) !== T.ROCK) fill(ctx, ox, oy, TILE, 2, P.rockLight);
          break;
        }
      }
    }
  }

  // Pass 2: tall things drawn top-to-bottom so lower rows overlap upper ones
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = at(tx, ty);
      const ox = tx * TILE;
      const oy = ty * TILE;
      if (t === T.TREE) drawTree(ctx, ox, oy, tx, ty);
      if (t === T.RUIN) drawPillar(ctx, ox, oy);
    }
  }
  return canvas;
}

function drawTree(ctx: Ctx, ox: number, oy: number, tx: number, ty: number): void {
  const v = hash2(tx, ty, 160);
  fill(ctx, ox + 3, oy + 13, 10, 2, P.shadow);
  fill(ctx, ox + 7, oy + 10, 2, 4, P.trunk);
  // canopy (rounded blob, rising 3px into the tile above)
  const top = oy - 3;
  fill(ctx, ox + 3, top, 10, 1, P.outline);
  fill(ctx, ox + 1, top + 1, 14, 1, P.outline);
  fill(ctx, ox, top + 2, 16, 9, P.outline);
  fill(ctx, ox + 1, top + 11, 14, 1, P.outline);
  fill(ctx, ox + 4, top + 12, 8, 1, P.outline);
  fill(ctx, ox + 3, top + 1, 10, 1, P.leaf);
  fill(ctx, ox + 1, top + 2, 14, 9, P.leaf);
  fill(ctx, ox + 2, top + 11, 12, 1, P.leafDark);
  fill(ctx, ox + 1, top + 8, 14, 3, P.leafDark);
  fill(ctx, ox + 3, top + 2, 6, 3, P.leafLight);
  fill(ctx, ox + 4, top + 2, 2, 1, P.leafHi);
  if (v > 0.5) {
    fill(ctx, ox + 10, top + 5, 2, 2, P.leafLight);
  } else if (v > 0.2) {
    fill(ctx, ox + 10, top + 4, 1, 1, P.red); // the odd apple
  }
}

function drawPillar(ctx: Ctx, ox: number, oy: number): void {
  fill(ctx, ox + 2, oy + 13, 12, 2, P.shadow);
  fill(ctx, ox + 3, oy - 6, 10, 19, P.outline);
  fill(ctx, ox + 4, oy - 5, 8, 17, P.stone);
  fill(ctx, ox + 4, oy - 5, 8, 2, P.stoneLight);
  fill(ctx, ox + 10, oy - 3, 2, 15, P.stoneDark);
  fill(ctx, ox + 6, oy, 1, 6, P.stoneDark);
  fill(ctx, ox + 3, oy - 7, 4, 2, P.outline); // broken top
}

/** Simple averaged colour per tile for the minimap. */
export const MINIMAP_COLORS: Record<number, string> = {
  [T.WATER]: P.water,
  [T.SAND]: P.sand,
  [T.GRASS]: P.grass,
  [T.PATH]: P.path,
  [T.BRIDGE]: P.plank,
  [T.TREE]: P.leafDark,
  [T.WALL]: P.stoneDark,
  [T.ROCK]: P.rockDark,
  [T.FLOOR]: P.floor,
  [T.FLOWERS]: P.grassLight,
  [T.FOREST_FLOOR]: P.forest,
  [T.DIRT]: P.dirt,
  [T.RUIN]: P.stone,
};
