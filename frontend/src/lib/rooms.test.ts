import { describe, expect, it } from "vitest";
import { cleanName, normalizeCode } from "./rooms";

describe("room input helpers", () => {
  it("normalises room codes", () => {
    expect(normalizeCode(" ab-c 12x9 ")).toBe("ABC12X");
  });
  it("cleans player names to what the server accepts", () => {
    expect(cleanName("  <Sir> Bob!! ")).toBe("Sir Bob");
    expect(cleanName("x".repeat(40))).toHaveLength(20);
  });
});
