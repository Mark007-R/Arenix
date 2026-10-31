import { describe, expect, it } from "vitest";
import { screenToMap } from "@/game/scenes/WorldScene";
import { groundColors, isoPalette, OUTFITS, TILE } from "./palette3d";
import { ARCHETYPES } from "@/game/archetypes";

describe("screen-relative movement", () => {
  const close = (a: [number, number], b: [number, number]) => {
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(a[1]).toBeCloseTo(b[1], 5);
  };

  it("maps screen directions onto the isometric island", () => {
    const d = Math.SQRT1_2;
    close(screenToMap(0, -1), [-d, -d]); // W: up the screen = north-west on the map
    close(screenToMap(1, 0), [d, -d]); // D: right = north-east
    close(screenToMap(0, 1), [d, d]); // S
    close(screenToMap(-1, 0), [-d, d]); // A
    close(screenToMap(1, -1), [0, -1]); // W+D: straight north
  });

  it("never exceeds the server's input range", () => {
    for (const sx of [-1, 0, 1]) {
      for (const sy of [-1, 0, 1]) {
        const [dx, dy] = screenToMap(sx, sy);
        expect(Math.abs(dx)).toBeLessThanOrEqual(1);
        expect(Math.abs(dy)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("palette", () => {
  it("has a ground colour for every tile type in both themes", () => {
    for (const theme of ["summer", "winter"]) {
      const g = groundColors(theme);
      for (const t of Object.values(TILE)) expect(g[t]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(isoPalette("winter").paper).not.toBe(isoPalette("summer").paper);
  });

  it("dresses every archetype", () => {
    for (const a of Object.keys(ARCHETYPES)) expect(OUTFITS[a]).toBeDefined();
  });
});
