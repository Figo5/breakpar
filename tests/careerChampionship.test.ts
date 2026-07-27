import { describe, expect, it } from "vitest";

import {
  CAREER_CHAMPIONSHIP_FIELD_SIZE,
  CAREER_CROWN_COURSE_SLUGS,
  assemblePersonalChampionshipField,
  championshipUnlock,
  orderEliteBotCompetitors,
  parseChampionshipCompetitorId,
  selectCrownCourseSlug,
} from "@/lib/career/championship";

function bots(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `bot:b${index + 1}`);
}

describe("Championship competitor id parsing", () => {
  it("parses human and bot ids", () => {
    expect(parseChampionshipCompetitorId("human:abc")).toEqual({
      competitorType: "HUMAN",
      profileId: "abc",
      botIdentityId: null,
    });
    expect(parseChampionshipCompetitorId("bot:xyz")).toEqual({
      competitorType: "BOT",
      profileId: null,
      botIdentityId: "xyz",
    });
  });

  it("rejects malformed ids", () => {
    expect(() => parseChampionshipCompetitorId("abc")).toThrow();
    expect(() => parseChampionshipCompetitorId("human:")).toThrow();
    expect(() => parseChampionshipCompetitorId("wizard:abc")).toThrow();
  });
});

describe("Crown course selection", () => {
  it("selects deterministically from the frozen pool intersected with seeded courses", () => {
    const available = [...CAREER_CROWN_COURSE_SLUGS, "pebble-beach"];
    const first = selectCrownCourseSlug("2098-07-23", 1, available);
    const again = selectCrownCourseSlug("2098-07-23", 1, available);
    expect(first).toBe(again);
    expect(CAREER_CROWN_COURSE_SLUGS).toContain(first as (typeof CAREER_CROWN_COURSE_SLUGS)[number]);
  });

  it("never selects a non-crown course and honours availability", () => {
    const only = selectCrownCourseSlug("2098-07-23", 1, ["augusta-national", "pebble-beach"]);
    expect(only).toBe("augusta-national");
  });

  it("varies across cycles but stays in the pool", () => {
    const slugs = new Set(
      Array.from({ length: 8 }, (_, cycle) =>
        selectCrownCourseSlug("2098-07-23", cycle + 1, [...CAREER_CROWN_COURSE_SLUGS])),
    );
    for (const slug of slugs) {
      expect(CAREER_CROWN_COURSE_SLUGS).toContain(slug as (typeof CAREER_CROWN_COURSE_SLUGS)[number]);
    }
    expect(slugs.size).toBeGreaterThan(1);
  });

  it("throws when no crown course is seeded", () => {
    expect(() => selectCrownCourseSlug("2098-07-23", 1, ["pebble-beach"])).toThrow();
  });
});

describe("Elite bot ordering", () => {
  it("is deterministic, stable, and prefixes bot ids", () => {
    const ids = ["b3", "b1", "b2", "b4"];
    const ordered = orderEliteBotCompetitors("2098-07-23", 1, ids);
    expect(orderEliteBotCompetitors("2098-07-23", 1, [...ids].reverse())).toEqual(ordered);
    expect(new Set(ordered).size).toBe(ids.length);
    expect(ordered.every((id) => id.startsWith("bot:"))).toBe(true);
  });
});

describe("Championship unlock (personal cycle, Challenger gate)", () => {
  it("unlocks every fourth settled season at Challenger or Pro", () => {
    expect(championshipUnlock(4, "CHALLENGER")).toEqual({ unlocked: true, cycleNumber: 1 });
    expect(championshipUnlock(8, "PRO")).toEqual({ unlocked: true, cycleNumber: 2 });
    expect(championshipUnlock(12, "CHALLENGER")).toEqual({ unlocked: true, cycleNumber: 3 });
  });

  it("does not unlock mid-cycle", () => {
    for (const seasons of [1, 2, 3, 5, 6, 7]) {
      expect(championshipUnlock(seasons, "PRO").unlocked).toBe(false);
    }
    // A career that has settled nothing has completed no cycle.
    expect(championshipUnlock(0, "PRO").unlocked).toBe(false);
  });

  it("does not unlock at Local, and never grants a missed cycle retroactively", () => {
    // Completing a cycle at Local unlocks nothing...
    expect(championshipUnlock(4, "LOCAL")).toEqual({ unlocked: false, cycleNumber: null });
    expect(championshipUnlock(8, "LOCAL")).toEqual({ unlocked: false, cycleNumber: null });
    // ...and promoting later only unlocks from the NEXT completed cycle, which
    // is cycle 3 — cycles 1 and 2 are not back-granted.
    expect(championshipUnlock(9, "CHALLENGER").unlocked).toBe(false);
    expect(championshipUnlock(12, "CHALLENGER")).toEqual({ unlocked: true, cycleNumber: 3 });
  });
});

describe("Personal Championship field assembly", () => {
  it("seats the qualifying player at slot 1 and fills to twenty with elite bots", () => {
    const field = assemblePersonalChampionshipField("human:me", bots(30));
    expect(field).toHaveLength(CAREER_CHAMPIONSHIP_FIELD_SIZE);
    expect(field[0]).toMatchObject({
      slotNumber: 1,
      competitorId: "human:me",
      competitorType: "HUMAN",
      profileId: "me",
    });
    expect(field.slice(1).every((slot) => slot.competitorType === "BOT")).toBe(true);
    expect(field.slice(1).every((slot) => slot.source === "elite-bot")).toBe(true);
    expect(new Set(field.map((slot) => slot.competitorId)).size).toBe(20);
    expect(field.map((slot) => slot.slotNumber)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("takes only the first nineteen bots when more are available", () => {
    const field = assemblePersonalChampionshipField("human:me", bots(30));
    expect(field.filter((slot) => slot.competitorType === "BOT")).toHaveLength(19);
    expect(field[1].competitorId).toBe("bot:b1");
    expect(field[19].competitorId).toBe("bot:b19");
  });

  it("throws when there are not enough elite bots to fill the field", () => {
    expect(() => assemblePersonalChampionshipField("human:me", bots(5)))
      .toThrow(/expected exactly 20/);
  });

  it("ignores a duplicated bot rather than seating it twice", () => {
    const duplicated = ["bot:b1", "bot:b1", ...bots(30).slice(1)];
    const field = assemblePersonalChampionshipField("human:me", duplicated);
    expect(new Set(field.map((slot) => slot.competitorId)).size).toBe(20);
  });
});
