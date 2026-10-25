import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DT, EPS, HALF_H, HALF_W, SPEED, boxBlocked, collisionLookup, step } from "./physics";

interface Vectors {
  width: number;
  height: number;
  collision: string;
  constants: { dt: number; speed: number; half_w: number; half_h: number; eps: number };
  cases: { name: string; speed?: number; start: [number, number]; inputs: [number, number][]; positions: [number, number][] }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../shared/test-vectors/movement.json"), "utf8"),
);

describe("physics parity with the Python server", () => {
  it("uses identical constants", () => {
    expect(vectors.constants).toEqual({ dt: DT, speed: SPEED, half_w: HALF_W, half_h: HALF_H, eps: EPS });
  });

  const solid = collisionLookup(vectors.collision, vectors.width, vectors.height);

  for (const c of vectors.cases) {
    it(`reproduces ${c.name} exactly`, () => {
      let [x, y] = c.start;
      c.inputs.forEach(([dx, dy], i) => {
        [x, y] = step(solid, x, y, dx, dy, c.speed ?? 1);
        const expected = c.positions[i]!;
        expect(x).toBe(expected[0]);
        expect(y).toBe(expected[1]);
        expect(boxBlocked(solid, x, y)).toBe(false);
      });
    });
  }
});
