import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatEvent, rejectionText } from "./feed";
import { QUICK_CHAT } from "@/shared/protocol";

const names = { p1: "Hero", bot1: "Lyra", bot2: "Quill" };

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

  it("announces eliminations and betrayals", () => {
    const vr = { seq: 4, tick: 9, type: "vote_resolved", data: { eliminated: "bot1", votes: {} } };
    expect(formatEvent(vr, names, "p1")?.text).toBe("The council voted out Lyra.");
    const betray = { seq: 5, tick: 9, type: "alliance_broken", data: { by: "bot2", partner: "p1", reason: "betrayal" } };
    expect(formatEvent(betray, names, "p1")).toEqual({ text: "Quill betrayed you in the vote!", tone: "bad" });
  });

  it("describes sheriff shots, misfires, sabotage and the jester", () => {
    const shot = { seq: 6, tick: 9, type: "contestant_killed", data: { killer: "p1", victim: "bot1", cause: "sheriff" } };
    expect(formatEvent(shot, names, "p1")).toEqual({ text: "Bullseye! Lyra was an impostor.", tone: "good" });
    const misfire = { seq: 7, tick: 9, type: "contestant_killed", data: { killer: "p1", victim: "p1", cause: "misfire" } };
    expect(formatEvent(misfire, names, "p1")?.tone).toBe("bad");
    const fog = { seq: 8, tick: 9, type: "sabotage", data: { kind: "fog" } };
    expect(formatEvent(fog, names, "p1")?.text).toContain("fog");
    const jester = { seq: 9, tick: 9, type: "vote_resolved", data: { eliminated: "bot2", was_jester: true, was_impostor: false } };
    expect(formatEvent(jester, names, "p1")?.text).toBe("Quill was the JESTER — and that's exactly what they wanted!");
    expect(rejectionText("bullet_used")).toBe("Your only bullet is spent.");
  });

  it("ignores unknown events", () => {
    expect(formatEvent({ seq: 1, tick: 1, type: "resource_regenerated", data: {} }, names, "p1")).toBeNull();
  });

  it("has friendly rejection text", () => {
    expect(rejectionText("out_of_range")).toMatch(/closer/);
    expect(rejectionText("???")).toBe("That didn't work.");
  });
});

describe("quick-chat parity", () => {
  it("matches the server's phrase list exactly", () => {
    const py = readFileSync(path.resolve(__dirname, "../../../backend/arenix/engine/social.py"), "utf8");
    const block = py.slice(py.indexOf("QUICK_CHAT"), py.indexOf("}", py.indexOf("QUICK_CHAT")));
    const server = Object.fromEntries([...block.matchAll(/"([a-z_]+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
    expect(server).toEqual(QUICK_CHAT);
  });
});
