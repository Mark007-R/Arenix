import { describe, expect, it } from "vitest";
import { formatEvent, rejectionText } from "./feed";

const names = { p1: "Hero", bot1: "Lyra" };

describe("formatEvent", () => {
  it("describes deliveries from the player's perspective", () => {
    const ev = { seq: 2, tick: 5, type: "resources_delivered", data: { contestant: "p1", accepted: { wood: 2, stone: 0 }, points: 20 } };
    expect(formatEvent(ev, names, "p1")).toEqual({ text: "You delivered 2 wood (+20).", tone: "mine" });
    expect(formatEvent(ev, names, "bot1")?.text).toBe("Hero delivered 2 wood (+20).");
  });

  it("hides other contestants' gathering to keep the feed calm", () => {
    const ev = { seq: 3, tick: 5, type: "resource_gathered", data: { contestant: "bot1", resource: "wood" } };
    expect(formatEvent(ev, names, "p1")).toBeNull();
  });

  it("ignores unknown events", () => {
    expect(formatEvent({ seq: 1, tick: 1, type: "resource_regenerated", data: {} }, names, "p1")).toBeNull();
  });

  it("has friendly rejection text", () => {
    expect(rejectionText("out_of_range")).toMatch(/closer/);
    expect(rejectionText("???")).toBe("That didn't work.");
  });
});
