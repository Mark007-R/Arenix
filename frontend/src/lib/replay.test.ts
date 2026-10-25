import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { replayTo } from "./replay";
import type { GameEventDTO } from "@/shared/protocol";

const vectors = JSON.parse(readFileSync(path.resolve(__dirname, "../../../shared/test-vectors/replay.json"), "utf8")) as {
  matches: {
    mode: string;
    events: GameEventDTO[];
    checkpoints: { seq: number; state: Record<string, unknown> }[];
  }[];
};

describe("replay reducer parity with the Python server", () => {
  for (const match of vectors.matches) {
    for (const cp of match.checkpoints) {
      it(`matches the server state (${match.mode}) at seq ${cp.seq}`, () => {
        expect(replayTo(match.events, cp.seq)).toEqual(cp.state);
      });
    }
  }
});
