import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { replayTo } from "./replay";
import type { GameEventDTO } from "@/shared/protocol";

const vectors = JSON.parse(readFileSync(path.resolve(__dirname, "../../../shared/test-vectors/replay.json"), "utf8")) as {
  events: GameEventDTO[];
  checkpoints: { seq: number; state: Record<string, unknown> }[];
};

describe("replay reducer parity with the Python server", () => {
  for (const cp of vectors.checkpoints) {
    it(`matches the server state at seq ${cp.seq}`, () => {
      expect(replayTo(vectors.events, cp.seq)).toEqual(cp.state);
    });
  }
});
