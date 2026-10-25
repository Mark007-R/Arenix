import { describe, expect, it } from "vitest";
import { Predictor } from "./prediction";
import { InterpolationBuffer } from "./interpolation";
import { step } from "./physics";

const open = () => false;

describe("Predictor", () => {
  it("applies inputs immediately and sequences them", () => {
    const p = new Predictor(open, 5, 5);
    const a = p.applyLocal(1, 0);
    const b = p.applyLocal(1, 0);
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(p.x).toBeGreaterThan(5);
  });

  it("does not correct when the server agrees", () => {
    const p = new Predictor(open, 5, 5);
    p.applyLocal(1, 0);
    p.applyLocal(0, 1);
    p.applyLocal(1, 1);
    const [sx, sy] = step(open, 5, 5, 1, 0);
    expect(p.reconcile(1, sx, sy)).toBe(0);
    expect(p.pendingCount).toBe(2);
  });

  it("rewinds and replays unacknowledged inputs when the server disagrees", () => {
    const p = new Predictor(open, 5, 5);
    p.applyLocal(1, 0);
    p.applyLocal(1, 0);
    // Server says the first input put us somewhere else (e.g. it was dropped).
    const correction = p.reconcile(1, 5, 5);
    expect(correction).toBeGreaterThan(0);
    const [ex] = step(open, 5, 5, 1, 0);
    expect(p.x).toBe(ex);
  });
});

describe("InterpolationBuffer", () => {
  it("interpolates between samples and clamps at the ends", () => {
    const b = new InterpolationBuffer();
    expect(b.sample(0)).toBeNull();
    b.push(0, 0, 0);
    b.push(100, 10, 20);
    expect(b.sample(-5)).toEqual({ x: 0, y: 0 });
    expect(b.sample(50)).toEqual({ x: 5, y: 10 });
    expect(b.sample(500)).toEqual({ x: 10, y: 20 });
  });

  it("ignores out-of-order samples", () => {
    const b = new InterpolationBuffer();
    b.push(100, 1, 1);
    b.push(50, 9, 9);
    expect(b.sample(100)).toEqual({ x: 1, y: 1 });
  });
});
