import { describe, expect, it } from "vitest";
import {
  applyInactivity,
  championshipField,
  blankLegacyAwardCounts,
  legacyPointBreakdown,
  legacyPoints,
  movementForSeason,
  pointsForPosition,
  rankEvent,
  rankSeason,
  seasonRating,
  tourRating,
  type SeasonCompetitor,
  type SeasonEventResult,
} from "@/lib/career/rules";

function event(
  eventIndex: number,
  competitorId: string,
  rank: number | null,
  points: number,
  relativeToPar: number | null = rank,
): SeasonEventResult {
  return {
    eventIndex,
    competitorId,
    completed: rank != null,
    relativeToPar,
    rank,
    points,
  };
}

function season(
  competitorId: string,
  points: number[],
  scores: number[] = points.map((_, index) => index),
  fallbackDraw = 0,
): SeasonCompetitor {
  return {
    competitorId,
    fallbackDraw,
    events: points.map((value, index) => event(index, competitorId, index + 1, value, scores[index])),
  };
}

describe("Career event points", () => {
  it("awards an unrounded 100-to-zero percentile curve", () => {
    expect(pointsForPosition(1, 20)).toBe(100);
    expect(pointsForPosition(20, 20)).toBe(0);
    expect(pointsForPosition(10, 20)).toBeCloseTo(52.6315789474);
  });

  it("averages occupied positions for ties and gives no-shows zero", () => {
    const standings = rankEvent([
      { competitorId: "a", relativeToPar: -3 },
      { competitorId: "b", relativeToPar: -1 },
      { competitorId: "c", relativeToPar: -1 },
      { competitorId: "d", relativeToPar: 2 },
      { competitorId: "dns", relativeToPar: null },
    ]);
    const byId = new Map(standings.map((standing) => [standing.competitorId, standing]));

    expect(byId.get("a")?.points).toBe(100);
    expect(byId.get("b")?.rank).toBe(2);
    expect(byId.get("c")?.rank).toBe(2);
    expect(byId.get("b")?.points).toBeCloseTo((75 + 50) / 2);
    expect(byId.get("d")?.points).toBe(25);
    expect(byId.get("dns")).toMatchObject({ completed: false, rank: null, points: 0 });
  });

  it.each([20, 30, 50, 100, 500])(
    "preserves the 50-point mean and occupied-position point pool at field size %i",
    (fieldSize) => {
      const untied = Array.from(
        { length: fieldSize },
        (_, index) => pointsForPosition(index + 1, fieldSize),
      );
      expect(untied.reduce((sum, value) => sum + value, 0) / fieldSize).toBeCloseTo(50);

      const tied = rankEvent(Array.from({ length: fieldSize }, (_, index) => ({
        competitorId: `p${index}`,
        relativeToPar: Math.floor(index / 2),
      })));
      expect(tied.reduce((sum, standing) => sum + standing.points, 0))
        .toBeCloseTo(untied.reduce((sum, value) => sum + value, 0));
    },
  );
});

describe("Career season standings and movement", () => {
  it("counts the best three of four events and requires three completions", () => {
    const ranked = rankSeason([
      season("best-three", [100, 90, 80, 1]),
      {
        competitorId: "inactive",
        fallbackDraw: 0,
        events: [
          event(0, "inactive", 1, 100, -5),
          event(1, "inactive", 1, 100, -5),
          event(2, "inactive", null, 0, null),
          event(3, "inactive", null, 0, null),
        ],
      },
    ]);

    expect(ranked[0]).toMatchObject({
      competitorId: "best-three",
      active: true,
      seasonPoints: 270,
      countingEventIndexes: [0, 1, 2],
    });
    expect(ranked[1]).toMatchObject({ competitorId: "inactive", active: false });
  });

  it("uses finishes, aggregate score, best score, then seeded draw as tiebreakers", () => {
    const ranked = rankSeason([
      season("worse-score", [90, 80, 70, 0], [2, 2, 2, 20], 0.1),
      season("better-score", [90, 80, 70, 0], [-1, 0, 1, 20], 0.9),
    ]);
    expect(ranked.map((standing) => standing.competitorId)).toEqual(["better-score", "worse-score"]);

    const fallback = rankSeason([
      season("later-draw", [90, 80, 70, 0], [0, 0, 0, 20], 0.9),
      season("earlier-draw", [90, 80, 70, 0], [0, 0, 0, 20], 0.1),
    ]);
    expect(fallback.map((standing) => standing.competitorId)).toEqual(["earlier-draw", "later-draw"]);
  });

  it("extends promotion and relegation through exact boundary ties", () => {
    const entries = [
      season("p1", [100, 100, 100, 0]),
      season("p2", [90, 90, 90, 0]),
      season("p3", [90, 90, 90, 0]),
      season("m1", [60, 60, 60, 0]),
      season("r1", [20, 20, 20, 0]),
      season("r2", [10, 10, 10, 0]),
      season("r3", [10, 10, 10, 0]),
      season("r4", [0, 0, 0, 0]),
      season("m2", [50, 50, 50, 0]),
      season("m3", [40, 40, 40, 0]),
    ];
    const movement = movementForSeason(rankSeason(entries), "challenger", 0.2);

    expect(movement.baseSlots).toBe(2);
    expect(movement.promoted).toBe(3);
    expect(movement.promotionTieExpansion).toBe(1);
    expect(movement.actions.get("p3")).toBe("promote");
    expect(movement.relegated).toBe(3);
    expect(movement.relegationTieExpansion).toBe(1);
    expect(movement.actions.get("r2")).toBe("relegate");
    expect(movement.actions.get("r3")).toBe("relegate");
    expect(movement.actions.get("r4")).toBe("relegate");
  });

  it("honors the Local floor and Pro ceiling", () => {
    const standings = rankSeason([
      season("one", [100, 100, 100, 0]),
      season("two", [0, 0, 0, 0]),
    ]);
    expect([...movementForSeason(standings, "local", 0.2).actions.values()]).not.toContain("relegate");
    expect([...movementForSeason(standings, "pro", 0.2).actions.values()]).not.toContain("promote");
  });
});

describe("Career inactivity and rating", () => {
  it("preserves the first inactive Pro season, relegates the second, and resets on activity", () => {
    const first = applyInactivity("pro", 0, false);
    expect(first).toEqual({ tier: "pro", consecutiveInactiveSeasons: 1 });
    const second = applyInactivity(first.tier, first.consecutiveInactiveSeasons, false);
    expect(second).toEqual({ tier: "challenger", consecutiveInactiveSeasons: 2 });
    expect(applyInactivity(second.tier, second.consecutiveInactiveSeasons, false)).toEqual({
      tier: "challenger",
      consecutiveInactiveSeasons: 3,
    });
    expect(applyInactivity("challenger", 4, true)).toEqual({
      tier: "challenger",
      consecutiveInactiveSeasons: 0,
    });
  });

  it("calculates tier-weighted percentile rating and best six of the last eight", () => {
    expect(seasonRating(30, 1, "pro")).toBe(225);
    expect(seasonRating(30, 30, "pro")).toBe(0);
    expect(seasonRating(30, 15, "challenger")).toBeCloseTo(77.5862068966);

    const history = [1000, 1, 2, 3, 4, 5, 6, 7, 8].map((rating) => ({ rating, active: true }));
    expect(tourRating(history)).toBe(3 + 4 + 5 + 6 + 7 + 8);
    expect(tourRating([...history.slice(-7), { rating: 999, active: false }])).toBe(3 + 4 + 5 + 6 + 7 + 8);
  });
});

describe("Career Legacy Points", () => {
  it("stacks non-negative permanent awards without allowing deductions", () => {
    const awards = {
      ...blankLegacyAwardCounts(),
      eventCompletion: 4,
      eventTopFive: 2,
      eventWin: 1,
      activeSeasonCompletion: 1,
      promotion: 1,
    };
    const schedule = {
      eventCompletion: 2,
      eventTopFive: 3,
      eventWin: 8,
      activeSeasonCompletion: 5,
      promotion: 12,
      proSurvival: 8,
      seasonChampionship: 15,
      championshipQualification: 20,
      championshipWin: 50,
    };
    expect(legacyPointBreakdown(awards, schedule)).toMatchObject({
      eventCompletion: 8,
      eventTopFive: 6,
      eventWin: 8,
      activeSeasonCompletion: 5,
      promotion: 12,
    });
    expect(legacyPoints(awards, schedule)).toBe(39);
    expect(legacyPoints({ ...awards, eventWin: -10 }, schedule)).toBe(31);
    expect(legacyPoints({ ...awards, eventWin: 2 }, schedule))
      .toBeGreaterThanOrEqual(legacyPoints(awards, schedule));
  });
});

describe("Championship qualification", () => {
  it("passes duplicate event-winner slots down the Pro standings", () => {
    const field = championshipField(
      ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"],
      ["p1", "winner-a", "p3", "winner-b"],
      ["c1", "c2"],
      ["elite-1", "elite-2", "elite-3", "elite-4", "elite-5", "elite-6"],
      20,
    );

    expect(field.filter((entry) => entry.source === "pro-passdown").map((entry) => entry.competitorId))
      .toEqual(["p7", "p8"]);
    expect(field.filter((entry) => entry.source === "pro-event-winner").map((entry) => entry.competitorId))
      .toEqual(["winner-a", "winner-b"]);
    expect(new Set(field.map((entry) => entry.competitorId)).size).toBe(field.length);
  });
});
