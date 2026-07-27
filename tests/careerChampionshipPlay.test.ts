import { describe, expect, it } from "vitest";

import {
  CAREER_CHAMPIONSHIP_BOT_ABILITY,
  championshipSlotSeed,
} from "@/lib/career/championshipPlay";

describe("Championship play pure helpers", () => {
  it("scores championship bots at the frozen Ace ability", () => {
    expect(CAREER_CHAMPIONSHIP_BOT_ABILITY).toBe("ace");
  });

  it("derives a deterministic per-slot seed namespace", () => {
    expect(championshipSlotSeed("2098-07-23", 1, 5)).toBe(
      "career:championship:2098-07-23:c1:slot5",
    );
    expect(championshipSlotSeed("2098-07-23", 1, 5)).toBe(
      championshipSlotSeed("2098-07-23", 1, 5),
    );
  });

  it("keeps seeds distinct across slot, cycle, and world", () => {
    const seeds = new Set([
      championshipSlotSeed("2098-07-23", 1, 1),
      championshipSlotSeed("2098-07-23", 1, 2),
      championshipSlotSeed("2098-07-23", 2, 1),
      championshipSlotSeed("2099-01-15", 1, 1),
    ]);
    expect(seeds.size).toBe(4);
  });
});
