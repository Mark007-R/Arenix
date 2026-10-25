/**
 * Exact TypeScript port of backend/arenix/engine/physics.py, used for client-side prediction.
 * The server remains authoritative; shared/test-vectors/movement.json keeps both in lockstep.
 * Only + - * / Math.sqrt and Math.floor are used so results are bit-identical to Python.
 */

export const TICK_RATE = 20;
export const DT = 1.0 / TICK_RATE;
export const SPEED = 4.5;
export const HALF_W = 0.3;
export const HALF_H = 0.2;
export const EPS = 1e-4;

export type SolidFn = (tx: number, ty: number) => boolean;

function boxHits(solid: SolidFn, left: number, top: number, right: number, bottom: number): boolean {
  const tx0 = Math.floor(left);
  const tx1 = Math.floor(right);
  const ty0 = Math.floor(top);
  const ty1 = Math.floor(bottom);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (solid(tx, ty)) return true;
    }
  }
  return false;
}

export function boxBlocked(solid: SolidFn, x: number, y: number): boolean {
  return boxHits(solid, x - HALF_W, y - HALF_H, x + HALF_W, y + HALF_H);
}

export function normalizeInput(dx: number, dy: number): [number, number] {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length > 1.0) return [dx / length, dy / length];
  return [dx, dy];
}

export function step(solid: SolidFn, x: number, y: number, dxIn: number, dyIn: number): [number, number] {
  const [dx, dy] = normalizeInput(dxIn, dyIn);
  const mx = dx * SPEED * DT;
  const my = dy * SPEED * DT;

  if (mx !== 0) {
    let nx = x + mx;
    if (boxHits(solid, nx - HALF_W, y - HALF_H, nx + HALF_W, y + HALF_H)) {
      nx = mx > 0 ? Math.floor(nx + HALF_W) - HALF_W - EPS : Math.floor(nx - HALF_W) + 1 + HALF_W + EPS;
      if (boxHits(solid, nx - HALF_W, y - HALF_H, nx + HALF_W, y + HALF_H)) nx = x;
    }
    x = nx;
  }

  if (my !== 0) {
    let ny = y + my;
    if (boxHits(solid, x - HALF_W, ny - HALF_H, x + HALF_W, ny + HALF_H)) {
      ny = my > 0 ? Math.floor(ny + HALF_H) - HALF_H - EPS : Math.floor(ny - HALF_H) + 1 + HALF_H + EPS;
      if (boxHits(solid, x - HALF_W, ny - HALF_H, x + HALF_W, ny + HALF_H)) ny = y;
    }
    y = ny;
  }

  return [x, y];
}

/** Build a solid() lookup from the server's collision string ("0"/"1" per tile, row-major). */
export function collisionLookup(collision: string, width: number, height: number): SolidFn {
  return (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
    return collision.charCodeAt(ty * width + tx) === 49; // "1"
  };
}
