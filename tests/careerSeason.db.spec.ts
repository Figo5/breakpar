import { execFileSync } from "node:child_process";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COURSES } from "@/data/courses";
import { advanceCareerAfterFinish, startCareerJourney } from "@/lib/career/journey";
import { finishCareerRound, startCareerEventRound } from "@/lib/career/eventPlay";
import {
  careerEventLeaderboard,
  careerProfileOwnsCohort,
  careerProfileOwnsEvent,
} from "@/lib/career/read";
import { runCareerTick } from "@/lib/career/scheduler";

/**
 * Player-paced Career — completion-driven event and season settlement
 * (Iteration 4). Real PostgreSQL, disposable schema.
 */
let admin: PrismaClient;
let db: PrismaClient;
let testSchema: string;

function schemaUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

let userSeq = 0;
async function newUser(label: string): Promise<{ id: string }> {
  userSeq += 1;
  return db.user.create({
    data: { guestId: `season-${label}-${userSeq}-${Date.now()}`, username: `Season ${label}` },
  });
}

/** Bots all shoot +5, so a human under par wins every event. */
const OPTS = { runtimeRevision: "career-season-test", simulateBotRound: () => 5 } as const;

/** Play one event end to end at the given score, then advance the Career. */
async function playEvent(
  userId: string,
  competitionId: string,
  relativeToPar: number,
): Promise<Awaited<ReturnType<typeof advanceCareerAfterFinish>>> {
  const started = await startCareerEventRound(db, userId, competitionId);
  if (!started.ok) throw new Error(`start failed: ${started.error}`);
  await db.holeResult.createMany({
    data: Array.from({ length: 18 }, (_, index) => ({
      roundId: started.roundId,
      holeNumber: index + 1,
      decision: "normal",
      outcome: "par",
      scoreChange: 0,
    })),
  });
  await db.round.update({
    where: { id: started.roundId },
    data: { score: 72 + relativeToPar, relativeToPar },
  });
  const finished = await finishCareerRound(db, started.roundId, userId, 120_000);
  if (!finished.ok) throw new Error(`finish failed: ${finished.error}`);
  return advanceCareerAfterFinish(db, competitionId, OPTS);
}

async function eventsOf(cohortId: string) {
  return db.careerCompetition.findMany({
    where: { cohortId, kind: "EVENT" },
    orderBy: { eventNumber: "asc" },
  });
}

beforeAll(async () => {
  const baseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required for Career PostgreSQL tests");

  testSchema = `career_test_season_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, "_");
  admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${testSchema}"`);

  const testUrl = schemaUrl(baseUrl, testSchema);
  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
    stdio: "pipe",
  });

  db = new PrismaClient({
    datasources: { db: { url: testUrl } },
    transactionOptions: { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 20_000 },
  });
  await db.course.createMany({
    data: COURSES.slice(0, 8).map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      location: entry.location,
      rating: entry.rating,
      slope: entry.slope,
      difficulty: entry.difficulty,
      wind: entry.wind,
      greens: entry.greens,
    })),
  });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (admin && testSchema) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
  }
  await admin?.$disconnect();
});

describe("Completion-driven event settlement", () => {
  it("finalizes an event the moment its human finishes", async () => {
    const user = await newUser("event");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];

    expect((await db.careerCompetition.findUniqueOrThrow({ where: { id: first.id } })).state)
      .toBe("ACTIVE");

    const advanced = await playEvent(user.id, first.id, -4);
    expect(advanced.eventsSettled).toBe(1);
    expect(advanced.seasonSettled).toBe(false);

    const settled = await db.careerCompetition.findUniqueOrThrow({ where: { id: first.id } });
    expect(settled.state).toBe("SETTLED");
    // One immutable final, with the human ranked first against +5 bots.
    const finals = await db.careerEventFinal.findMany({ where: { competitionId: first.id } });
    expect(finals).toHaveLength(1);
    const standings = finals[0].standings as Array<{ competitorType: string; rank: number | null }>;
    expect(standings).toHaveLength(20);
    expect(standings.find((row) => row.competitorType === "HUMAN")!.rank).toBe(1);
  });

  it("is idempotent under a duplicate advance", async () => {
    const user = await newUser("dupe");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];
    await playEvent(user.id, first.id, -2);

    // A second advance for the same event must publish nothing new.
    const again = await advanceCareerAfterFinish(db, first.id, OPTS);
    expect(again.eventsSettled).toBe(0);
    expect(await db.careerEventFinal.count({ where: { competitionId: first.id } })).toBe(1);
  });

  it("leaves the other three events untouched and still playable", async () => {
    const user = await newUser("partial");
    const state = await startCareerJourney(db, user.id, OPTS);
    await playEvent(user.id, state.competitions[0].id, -1);

    const events = await eventsOf(state.cohort.id);
    expect(events.map((event) => event.state)).toEqual(["SETTLED", "ACTIVE", "ACTIVE", "ACTIVE"]);
    expect((await db.careerCohort.findUniqueOrThrow({ where: { id: state.cohort.id } })).state)
      .toBe("ACTIVE");
  });
});

describe("Fourth completion settles the season", () => {
  it("does not settle a season with three events complete", async () => {
    const user = await newUser("three");
    const state = await startCareerJourney(db, user.id, OPTS);
    for (const competition of state.competitions.slice(0, 3)) {
      await playEvent(user.id, competition.id, -3);
    }
    const cohort = await db.careerCohort.findUniqueOrThrow({ where: { id: state.cohort.id } });
    expect(cohort.state).toBe("ACTIVE");
    expect(await db.careerSeasonSettlement.count({ where: { cohortId: state.cohort.id } })).toBe(0);
    // Season N+1 must not exist yet.
    expect(await db.careerCohort.count({ where: { worldId: state.world.id } })).toBe(1);
    expect((await db.careerProfile.findUniqueOrThrow({ where: { id: state.profile.id } })).currentSeason)
      .toBe(1);
  });

  it("settles on the fourth finish and opens the next season with a locked field", async () => {
    const user = await newUser("full");
    const state = await startCareerJourney(db, user.id, OPTS);
    let advanced;
    for (const competition of state.competitions) {
      advanced = await playEvent(user.id, competition.id, -6);
    }
    expect(advanced!.seasonSettled).toBe(true);
    expect(advanced!.nextCohortId).not.toBeNull();

    // Season 1 is settled exactly once.
    expect((await db.careerCohort.findUniqueOrThrow({ where: { id: state.cohort.id } })).state)
      .toBe("SETTLED");
    expect(await db.careerSeasonSettlement.count({ where: { cohortId: state.cohort.id } })).toBe(1);

    // History, rating, and Legacy all published.
    const history = await db.careerSeasonHistory.findUniqueOrThrow({
      where: { profileId_cohortId: { profileId: state.profile.id, cohortId: state.cohort.id } },
    });
    expect(history).toMatchObject({ active: true, completedEvents: 4, rank: 1 });
    expect(await db.careerRatingHistory.count({ where: { profileId: state.profile.id } })).toBe(1);
    expect(await db.careerLegacyLedger.count({ where: { profileId: state.profile.id } }))
      .toBeGreaterThan(0);

    // Profile projections: season advanced and the cycle counter incremented.
    const profile = await db.careerProfile.findUniqueOrThrow({ where: { id: state.profile.id } });
    expect(profile.currentSeason).toBe(2);
    expect(profile.settledSeasons).toBe(1);
    expect(profile.legacyTotal).toBeGreaterThan(0);

    // Season 2 exists and is immediately playable with a full locked field.
    const next = await db.careerCohort.findUniqueOrThrow({ where: { id: advanced!.nextCohortId! } });
    expect(next.seasonNumber).toBe(2);
    expect(next.state).toBe("ACTIVE");
    const nextEvents = await eventsOf(next.id);
    expect(nextEvents).toHaveLength(4);
    expect(nextEvents.every((event) => event.state === "ACTIVE")).toBe(true);
    for (const event of nextEvents) {
      expect(await db.careerFieldSlot.count({ where: { competitionId: event.id } })).toBe(20);
    }
    // The player is entered in all four of the new season's events.
    expect(await db.careerEventEntry.count({
      where: { profileId: state.profile.id, competition: { cohortId: next.id } },
    })).toBe(4);
  });

  it("settles exactly once under concurrent advances and creates one next season", async () => {
    const user = await newUser("race");
    const state = await startCareerJourney(db, user.id, OPTS);
    for (const competition of state.competitions.slice(0, 3)) {
      await playEvent(user.id, competition.id, -3);
    }

    // Finish the fourth, then fire two advances at once.
    const fourth = state.competitions[3];
    const started = await startCareerEventRound(db, user.id, fourth.id);
    if (!started.ok) throw new Error("start failed");
    await db.holeResult.createMany({
      data: Array.from({ length: 18 }, (_, index) => ({
        roundId: started.roundId,
        holeNumber: index + 1,
        decision: "normal",
        outcome: "par",
        scoreChange: 0,
      })),
    });
    await db.round.update({ where: { id: started.roundId }, data: { score: 68, relativeToPar: -4 } });
    await finishCareerRound(db, started.roundId, user.id, 120_000);

    const outcomes = await Promise.allSettled([
      advanceCareerAfterFinish(db, fourth.id, OPTS),
      advanceCareerAfterFinish(db, fourth.id, OPTS),
    ]);
    const settledCount = outcomes.filter(
      (outcome) => outcome.status === "fulfilled" && outcome.value.seasonSettled,
    ).length;
    expect(settledCount).toBe(1);

    // Exactly one settlement, one successor season, no duplicate history.
    expect(await db.careerSeasonSettlement.count({ where: { cohortId: state.cohort.id } })).toBe(1);
    expect(await db.careerCohort.count({
      where: { worldId: state.world.id, seasonNumber: 2 },
    })).toBe(1);
    expect(await db.careerSeasonHistory.count({ where: { cohortId: state.cohort.id } })).toBe(1);
    expect((await db.careerProfile.findUniqueOrThrow({ where: { id: state.profile.id } })).settledSeasons)
      .toBe(1);
  });

  it("runs consecutive seasons back to back with no waiting", async () => {
    const user = await newUser("consecutive");
    let state = await startCareerJourney(db, user.id, OPTS);

    for (let season = 1; season <= 3; season++) {
      const events = await eventsOf(state.cohort.id);
      expect(events).toHaveLength(4);
      for (const event of events) await playEvent(user.id, event.id, -5);

      const profile = await db.careerProfile.findUniqueOrThrow({ where: { id: state.profile.id } });
      expect(profile.settledSeasons).toBe(season);
      expect(profile.currentSeason).toBe(season + 1);

      // Re-read to pick up the freshly created season.
      state = await startCareerJourney(db, user.id, OPTS);
      expect(state.cohort.seasonNumber).toBe(season + 1);
    }

    expect(await db.careerSeasonHistory.count({ where: { profileId: state.profile.id } })).toBe(3);
    expect(await db.careerRatingHistory.count({ where: { profileId: state.profile.id } })).toBe(3);
  });

  it("applies best-three-of-four to the season total", async () => {
    const user = await newUser("bestthree");
    const state = await startCareerJourney(db, user.id, OPTS);
    // Three wins (beating the +5 bots) and one deliberate blow-up.
    const scores = [-6, -6, -6, 20];
    for (const [index, competition] of state.competitions.entries()) {
      await playEvent(user.id, competition.id, scores[index]);
    }
    const history = await db.careerSeasonHistory.findUniqueOrThrow({
      where: { profileId_cohortId: { profileId: state.profile.id, cohortId: state.cohort.id } },
    });
    // Best three are the three wins (100 points each in a 20-field).
    expect(history.seasonPoints).toBe(300);
    expect(history.completedEvents).toBe(4);
  });
});

describe("Opponent reveal rule", () => {
  it("hides opponents until the viewer has completed the event", async () => {
    const user = await newUser("reveal");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];

    // Before playing: the bot cards already exist in the locked field, but
    // knowing the number to beat would change aggression, so nothing shows.
    const hidden = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(hidden).not.toBeNull();
    expect(hidden!.revealed).toBe(false);
    expect(hidden!.standings.every((row) => row.relativeToPar === null)).toBe(true);
    expect(hidden!.standings.filter((row) => row.competitorType === "BOT")).toHaveLength(0);

    await playEvent(user.id, first.id, -4);

    const shown = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(shown!.revealed).toBe(true);
    expect(shown!.standings).toHaveLength(20);
    expect(shown!.standings.some((row) => row.competitorType === "BOT")).toBe(true);
  });

  it("reveals nothing to an anonymous viewer", async () => {
    const user = await newUser("anon");
    const state = await startCareerJourney(db, user.id, OPTS);
    const board = await careerEventLeaderboard(db, state.competitions[0].id, null);
    expect(board!.revealed).toBe(false);
    expect(board!.standings).toHaveLength(0);
  });
});

describe("Personal Journey read boundaries", () => {
  it("does not authorize a profile to read another Journey's event or season", async () => {
    const firstUser = await newUser("owner-a");
    const secondUser = await newUser("owner-b");
    const first = await startCareerJourney(db, firstUser.id, OPTS);
    const second = await startCareerJourney(db, secondUser.id, OPTS);

    expect(await careerProfileOwnsEvent(
      db,
      first.profile.id,
      first.competitions[0].id,
    )).toBe(true);
    expect(await careerProfileOwnsCohort(
      db,
      first.profile.id,
      first.cohort.id,
    )).toBe(true);

    expect(await careerProfileOwnsEvent(
      db,
      second.profile.id,
      first.competitions[0].id,
    )).toBe(false);
    expect(await careerProfileOwnsCohort(
      db,
      second.profile.id,
      first.cohort.id,
    )).toBe(false);
  });
});

describe("Recovery scan", () => {
  it("completes a season whose write-path advance never ran", async () => {
    const user = await newUser("recovery");
    const state = await startCareerJourney(db, user.id, OPTS);

    // Play all four events WITHOUT advancing — simulating four crashed requests.
    for (const competition of state.competitions) {
      const started = await startCareerEventRound(db, user.id, competition.id);
      if (!started.ok) throw new Error("start failed");
      await db.holeResult.createMany({
        data: Array.from({ length: 18 }, (_, index) => ({
          roundId: started.roundId,
          holeNumber: index + 1,
          decision: "normal",
          outcome: "par",
          scoreChange: 0,
        })),
      });
      await db.round.update({
        where: { id: started.roundId },
        data: { score: 66, relativeToPar: -6 },
      });
      await finishCareerRound(db, started.roundId, user.id, 120_000);
    }
    expect((await db.careerCohort.findUniqueOrThrow({ where: { id: state.cohort.id } })).state)
      .toBe("ACTIVE");

    // The scan finds the stranded work and finishes it.
    const summary = await runCareerTick(db, { runtimeRevision: "career-season-test" });
    expect(summary.errors.filter((e) => e.includes(state.cohort.id))).toEqual([]);

    expect((await db.careerCohort.findUniqueOrThrow({ where: { id: state.cohort.id } })).state)
      .toBe("SETTLED");
    expect(await db.careerSeasonSettlement.count({ where: { cohortId: state.cohort.id } })).toBe(1);
    const profile = await db.careerProfile.findUniqueOrThrow({ where: { id: state.profile.id } });
    expect(profile.settledSeasons).toBe(1);
    expect(profile.currentSeason).toBe(2);

    // And the successor season arrives with a locked field.
    const next = await db.careerCohort.findFirstOrThrow({
      where: { worldId: state.world.id, seasonNumber: 2 },
    });
    expect(next.state).toBe("ACTIVE");
  });

  it("is a no-op when nothing is stranded", async () => {
    const before = await runCareerTick(db, { runtimeRevision: "career-season-test" });
    const after = await runCareerTick(db, { runtimeRevision: "career-season-test" });
    expect(after.eventsSettled).toBe(0);
    expect(after.seasonsSettled).toBe(0);
    expect(after.errors).toEqual([]);
    expect(before.at <= after.at).toBe(true);
  });
});
