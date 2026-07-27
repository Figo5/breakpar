import { describe, expect, it } from "vitest";
import {
  calculateCareerSeasonSettlement,
  type CareerSeasonSettlementInput,
  type SeasonSettlementCompetitor,
  type SeasonSettlementProfileState,
} from "@/lib/career/seasonSettlement";
import type { CareerTier, RatingSeason, SeasonEventResult } from "@/lib/career/rules";

/** One event standing. `rank`/`points`/`rel` null ⇒ a no-show for that event. */
function ev(eventIndex: number, competitorId: string, rank: number | null, points: number, rel: number | null): SeasonEventResult {
  return { eventIndex, competitorId, completed: rank != null, relativeToPar: rel, rank, points };
}

interface Spec {
  id: string;
  type: "HUMAN" | "BOT";
  points: number;      // per-event points (best-three = 3×points); higher ⇒ better season rank
  completed?: number;  // completed events (default 4); <4 is a corrupt season
  rank?: number;       // per-event rank (defaults to a distinct value)
  state?: Partial<SeasonSettlementProfileState>;
}

function build(tier: CareerTier, specs: Spec[], seasonNumber = 1): CareerSeasonSettlementInput {
  const competitors: SeasonSettlementCompetitor[] = specs.map((spec, index) => {
    const completed = spec.completed ?? 4;
    const rank = spec.rank ?? index + 1;
    const events: SeasonEventResult[] = Array.from({ length: 4 }, (_, eventIndex) =>
      eventIndex < completed
        ? ev(eventIndex, spec.id, rank, spec.points, index)
        : ev(eventIndex, spec.id, null, 0, null));
    return {
      competitorId: spec.id,
      competitorType: spec.type,
      profileId: spec.type === "HUMAN" ? spec.id : null,
      botIdentityId: spec.type === "BOT" ? spec.id : null,
      events,
      fallbackDraw: index / 1000,
    };
  });
  const humanState: Record<string, SeasonSettlementProfileState> = {};
  for (const spec of specs) {
    if (spec.type !== "HUMAN") continue;
    humanState[spec.id] = {
      profileId: spec.id,
      tier,
      status: "ACTIVE",
      settledSeasons: 0,
      movementEvidence: [],
      priorRatings: [],
      ...spec.state,
    };
  }
  return {
    worldId: "world",
    cohortId: `cohort-${tier}`,
    seasonNumber,
    tier,
    eventIds: ["event-1", "event-2", "event-3", "event-4"],
    competitors,
    humanState,
  };
}

/** N active competitors, points N..1 so index 0 is season rank 1. */
function ladder(tier: CareerTier, n: number, humanIndexes: number[], overrides: Record<number, Partial<Spec>> = {}): CareerSeasonSettlementInput {
  const specs: Spec[] = Array.from({ length: n }, (_, index) => ({
    id: humanIndexes.includes(index) ? `human-${index}` : `bot-${index}`,
    type: humanIndexes.includes(index) ? "HUMAN" : "BOT",
    points: n - index,
    rank: index + 1,
    ...overrides[index],
  }));
  return build(tier, specs);
}

describe("Career season settlement — season math", () => {
  it("counts the best three of four completed events", () => {
    const input = build("local", [
      { id: "human-a", type: "HUMAN", points: 90, completed: 4 },
      { id: "bot-1", type: "BOT", points: 40 },
    ]);
    const a = calculateCareerSeasonSettlement(input).humans[0];
    expect(a.active).toBe(true);
    expect(a.seasonPoints).toBe(270); // best 3 × 90
    expect(a.completedEvents).toBe(4);
    expect(a.rank).toBe(1);
  });

  it("refuses to settle a season whose human has not completed all four events", () => {
    // Player-paced Career only settles a season once every event is finished,
    // so an incomplete human here is a corrupt season, not an absence.
    const input = build("local", [
      { id: "human-a", type: "HUMAN", points: 50, completed: 2 },
      { id: "bot-1", type: "BOT", points: 40 },
    ]);
    expect(() => calculateCareerSeasonSettlement(input))
      .toThrow(/reached season settlement with only 2 completed events/);
  });
});

describe("Career season settlement — Candidate H movement", () => {
  it("promotes when the two-season average ≥0.65 and both seasons ≥0.58", () => {
    // 5 active; human at rank 2 ⇒ percentile 0.75. Prior evidence 0.75 ⇒ avg 0.75.
    const input = ladder("local", 5, [1], { 1: { state: { movementEvidence: [0.75] } } });
    const human = calculateCareerSeasonSettlement(input).humans[0];
    expect(human.movement).toBe("promote");
    expect(human.nextTier).toBe("challenger");
    // Promotion carries one bounded item: 0.5 + 0.25×(0.75 − 0.5) = 0.5625.
    expect(human.nextMovementEvidence).toEqual([0.5625]);
  });

  it("holds a ≥0.65 average when one season is below the 0.58 floor", () => {
    // human rank 1 of 5 ⇒ percentile 1.0; prior evidence 0.5 ⇒ avg 0.75 but 0.5<0.58.
    const input = ladder("local", 5, [0], { 0: { state: { movementEvidence: [0.5] } } });
    const human = calculateCareerSeasonSettlement(input).humans[0];
    expect(human.movement).toBe("hold");
    expect(human.nextTier).toBe("local");
  });

  it("relegates when the two-season average ≤0.32 (Challenger)", () => {
    // human rank 4 of 5 ⇒ percentile 0.25; prior evidence 0.25 ⇒ avg 0.25.
    const input = ladder("challenger", 5, [3], { 3: { state: { movementEvidence: [0.25] } } });
    const human = calculateCareerSeasonSettlement(input).humans[0];
    expect(human.movement).toBe("relegate");
    expect(human.nextTier).toBe("local");
    expect(human.nextMovementEvidence).toEqual([]); // cleared on relegation
  });

  it("retires the human movement cap: every qualifying human moves", () => {
    // 30 humans all clearing the promote bar. Under the old percentage cap only
    // ceil(0.2 × 30) = 6 could promote; the cap is gone, so all 30 do.
    const overrides: Record<number, Partial<Spec>> = {};
    for (let i = 0; i < 30; i++) overrides[i] = { state: { movementEvidence: [0.9] } };
    const input = ladder("local", 30, Array.from({ length: 30 }, (_, i) => i), overrides);
    const out = calculateCareerSeasonSettlement(input);
    expect(out.humanMovementLimit).toBeNull();
    const promoted = out.humans.filter((h) => h.movement === "promote");
    expect(promoted.length).toBeGreaterThan(6);
    expect(out.humans.every((h) => h.movementState === "normal")).toBe(true);
  });
});

describe("Career season settlement — rating, Legacy, continuation", () => {
  it("never relegates for absence: elapsed time cannot change a tier", () => {
    // Inactivity is deleted. A Pro who completes their season holds Pro
    // regardless of how long the season took in real time.
    const proSeason = ladder("pro", 5, [2]);
    const human = calculateCareerSeasonSettlement(proSeason).humans[0];
    expect(human.active).toBe(true);
    expect(human.movement).not.toBe("inactive");
    expect(human.nextTier).toBe("pro");
  });

  it("computes season rating and best-six-of-eight Tour Rating from regular seasons", () => {
    const priorRatings: RatingSeason[] = [10, 20, 30, 40, 50, 60, 70].map((rating) => ({ rating, active: true }));
    const input = ladder("pro", 5, [0], { 0: { state: { movementEvidence: [], priorRatings } } });
    const human = calculateCareerSeasonSettlement(input).humans[0];
    // rank 1 of 5 active at Pro ⇒ 100 × 1.0 × 2.25 = 225.
    expect(human.seasonRating).toBe(225);
    // best six of the last eight [10..70, 225] ⇒ 225+70+60+50+40+30 = 475.
    expect(human.tourRating).toBe(475);
  });

  it("emits the frozen Legacy award set for the season champion", () => {
    // Single active Pro human, rank 1 ⇒ season champion; two event wins + top-fives.
    const events: SeasonEventResult[] = [
      ev(0, "human-a", 1, 100, -5),
      ev(1, "human-a", 1, 100, -4),
      ev(2, "human-a", 3, 60, 0),
      ev(3, "human-a", 8, 10, 4),
    ];
    const input: CareerSeasonSettlementInput = {
      worldId: "w", cohortId: "c", seasonNumber: 1, tier: "pro",
      eventIds: ["event-1", "event-2", "event-3", "event-4"],
      competitors: [
        { competitorId: "human-a", competitorType: "HUMAN", profileId: "human-a", botIdentityId: null, events, fallbackDraw: 0 },
        { competitorId: "bot-1", competitorType: "BOT", profileId: null, botIdentityId: "bot-1", events: [ev(0, "bot-1", 2, 75, 0), ev(1, "bot-1", 2, 75, 0), ev(2, "bot-1", 2, 75, 0), ev(3, "bot-1", 2, 75, 0)], fallbackDraw: 0.1 },
      ],
      humanState: { "human-a": { profileId: "human-a", tier: "pro", status: "ACTIVE", settledSeasons: 0, movementEvidence: [], priorRatings: [] } },
    };
    const a = calculateCareerSeasonSettlement(input).humans[0];
    expect(a.legacyAwards.eventCompletion).toBe(4);
    expect(a.legacyAwards.eventWin).toBe(2);
    expect(a.legacyAwards.eventTopFive).toBe(3); // ranks 1,1,3 (rank 8 excluded)
    expect(a.legacyAwards.activeSeasonCompletion).toBe(1);
    expect(a.legacyAwards.proSurvival).toBe(1); // active Pro, not relegated
    expect(a.legacyAwards.seasonChampionship).toBe(1);
    expect(a.legacyAwards.promotion).toBe(0); // Pro never promotes
    expect(a.isSeasonChampion).toBe(true);
    expect(a.legacyEffects.filter((effect) => effect.sourceType === "event")).toHaveLength(9);
    expect(a.legacyEffects.filter((effect) => effect.sourceType === "season")).toEqual([
      {
        sourceType: "season",
        sourceId: "c",
        awardType: "activeSeasonCompletion",
        points: 3,
      },
      {
        sourceType: "season",
        sourceId: "c",
        awardType: "proSurvival",
        points: 12,
      },
      {
        sourceType: "season",
        sourceId: "c",
        awardType: "seasonChampionship",
        points: 30,
      },
    ]);
  });

  it("continues every human regardless of archival status", () => {
    // `status` is archival only in player-paced Career: nothing expires, so
    // pausing cannot withhold the next season.
    const input = ladder("challenger", 4, [0, 1], {
      0: { state: { status: "PAUSED" } },
      1: { state: { status: "RETIRED" } },
    });
    const out = calculateCareerSeasonSettlement(input);
    expect(out.humans).toHaveLength(2);
    expect(out.humans.every((h) => h.active)).toBe(true);
    expect(out.humans.every((h) => h.nextTier.length > 0)).toBe(true);
  });
});
