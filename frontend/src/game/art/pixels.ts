/** Tiny pixel-drawing toolkit used to author all ARENIX art procedurally (original assets). */

export class Pixels {
  readonly w: number;
  readonly h: number;
  private data: (string | null)[];
  /** Drawing offset applied by px(); lets art be authored in a smaller logical box. */
  offsetX = 0;
  offsetY = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Array(w * h).fill(null);
  }

  get(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.data[y * this.w + x] ?? null;
  }

  px(x: number, y: number, c: string | null): void {
    x += this.offsetX;
    y += this.offsetY;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: string | null): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  }

  hline(x0: number, x1: number, y: number, c: string): void {
    for (let x = x0; x <= x1; x++) this.px(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: string): void {
    for (let y = y0; y <= y1; y++) this.px(x, y, c);
  }

  /** Filled ellipse inside the given box. */
  ellipse(x: number, y: number, w: number, h: number, c: string): void {
    const cx = x + w / 2 - 0.5;
    const cy = y + h / 2 - 0.5;
    const rx = w / 2;
    const ry = h / 2;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const dx = (xx - cx) / rx;
        const dy = (yy - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) this.px(xx, yy, c);
      }
    }
  }

  /** Add a 1px outline around every opaque pixel (4-neighbourhood). */
  outline(c: string): void {
    const add: number[] = [];
    // Translucent pixels (shadows) neither receive nor cast an outline.
    const solidAt = (x: number, y: number) => {
      const v = this.get(x, y);
      return v !== null && !v.startsWith("rgba");
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (solidAt(x, y)) continue;
        if (solidAt(x - 1, y) || solidAt(x + 1, y) || solidAt(x, y - 1) || solidAt(x, y + 1)) {
          add.push(y * this.w + x);
        }
      }
    }
    for (const i of add) this.data[i] = c;
  }

  flipX(): Pixels {
    const out = new Pixels(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) out.px(this.w - 1 - x, y, this.get(x, y));
    return out;
  }

  drawTo(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.data[y * this.w + x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(ox + x, oy + y, 1, 1);
        }
      }
    }
  }
}

/** Deterministic per-tile hash in [0, 1) for decorative variation. */
export function hash2(x: number, y: number, salt = 0): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return (n & 0xffffff) / 0x1000000;
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}
