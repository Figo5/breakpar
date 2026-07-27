import { execFileSync } from "node:child_process";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COURSES } from "@/data/courses";
import { CAREER_NO_DEADLINE, careerJourneyKey } from "@/lib/career/constants";
import { startCareerJourney } from "@/lib/career/journey";
import { startCareerEventRound } from "@/lib/career/eventPlay";

/**
 * Player-paced Career — Journey creation and instant field formation
 * (Iteration 3). Real PostgreSQL, disposable schema.
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
    data: { guestId: `journey-${label}-${userSeq}-${Date.now()}`, username: `Journey ${label}` },
  });
}

/** Deterministic bot scores keep assertions about the field stable. */
const OPTS = { runtimeRevision: "career-journey-test", simulateBotRound: () => 3 } as const;

beforeAll(async () => {
  const baseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required for Career PostgreSQL tests");

  testSchema = `career_test_journey_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, "_");
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

describe("Personal Journey creation", () => {
  it("creates one Journey keyed to the player, with a personal 30-bot roster", async () => {
    const user = await newUser("solo");
    const state = await startCareerJourney(db, user.id, OPTS);

    expect(state.world.worldKey).toBe(careerJourneyKey(user.id));
    expect(state.profile).toMatchObject({ tier: "LOCAL", currentSeason: 1, settledSeasons: 0 });
    expect(await db.careerBotIdentity.count({ where: { worldId: state.world.id } })).toBe(30);
    // Exactly one profile per Journey — this is a personal universe.
    expect(await db.careerProfile.count({ where: { worldId: state.world.id } })).toBe(1);
  });

  it("is idempotent: repeated entry returns the same Journey, season, and field", async () => {
    const user = await newUser("repeat");
    const first = await startCareerJourney(db, user.id, OPTS);
    const second = await startCareerJourney(db, user.id, OPTS);
    const third = await startCareerJourney(db, user.id, OPTS);

    expect(second.world.id).toBe(first.world.id);
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.cohort.id).toBe(first.cohort.id);
    expect(third.cohort.id).toBe(first.cohort.id);
    expect(await db.careerCohort.count({ where: { worldId: first.world.id } })).toBe(1);
    // One lock revision per event, never re-locked.
    expect(await db.careerLockRevision.count({
      where: { competition: { cohortId: first.cohort.id } },
    })).toBe(4);
  });

  it("creates exactly one Journey under concurrent first entry", async () => {
    const user = await newUser("race");
    const [a, b] = await Promise.all([
      startCareerJourney(db, user.id, OPTS),
      startCareerJourney(db, user.id, OPTS),
    ]);
    expect(a.world.id).toBe(b.world.id);
    expect(a.profile.id).toBe(b.profile.id);
    expect(await db.careerProfile.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.careerWorld.count({ where: { worldKey: careerJourneyKey(user.id) } })).toBe(1);
  });

  it("gives different players separate Journeys and separate rosters", async () => {
    const [one, two] = [await newUser("p1"), await newUser("p2")];
    const a = await startCareerJourney(db, one.id, OPTS);
    const b = await startCareerJourney(db, two.id, OPTS);
    expect(a.world.id).not.toBe(b.world.id);
    const aBots = await db.careerBotIdentity.count({ where: { worldId: a.world.id } });
    const bBots = await db.careerBotIdentity.count({ where: { worldId: b.world.id } });
    expect(aBots).toBe(30);
    expect(bBots).toBe(30);
  });
});

describe("Instant field formation", () => {
  it("locks one human plus nineteen bots across all four events", async () => {
    const user = await newUser("field");
    const state = await startCareerJourney(db, user.id, OPTS);

    expect(state.cohort.state).toBe("ACTIVE");
    expect(state.competitions).toHaveLength(4);

    for (const competition of state.competitions) {
      const slots = await db.careerFieldSlot.findMany({
        where: { competitionId: competition.id },
        orderBy: { slotId: "asc" },
      });
      expect(slots).toHaveLength(20);
      expect(slots.filter((slot) => slot.competitorType === "HUMAN")).toHaveLength(1);
      expect(slots.filter((slot) => slot.competitorType === "BOT")).toHaveLength(19);
      // The human always holds slot 1.
      expect(slots[0]).toMatchObject({ slotId: 1, competitorType: "HUMAN", profileId: state.profile.id });
      expect(slots.slice(1).every((slot) => slot.botIdentityId !== null)).toBe(true);
    }
  });

  it("materializes every bot's card for all four events at season start", async () => {
    const user = await newUser("bots");
    const state = await startCareerJourney(db, user.id, OPTS);

    for (const competition of state.competitions) {
      const results = await db.careerResult.findMany({ where: { competitionId: competition.id } });
      expect(results).toHaveLength(20);
      const botResults = results.filter((result) => result.competitorType === "BOT");
      expect(botResults).toHaveLength(19);
      // Every bot has already played; the human has not.
      expect(botResults.every((result) => result.completed && result.relativeToPar === 12)).toBe(true);
      const human = results.find((result) => result.competitorType === "HUMAN")!;
      expect(human.completed).toBe(false);
    }
  });

  it("produces deterministic bot scores through the real engine", async () => {
    // No simulateBotRound override: exercise the real engine.
    const real = { runtimeRevision: "career-journey-real" } as const;
    const one = await startCareerJourney(db, (await newUser("det1")).id, real);
    const two = await startCareerJourney(db, (await newUser("det2")).id, real);

    const scoresFor = async (cohortId: string) =>
      (await db.careerResult.findMany({
        where: { competition: { cohortId }, competitorType: "BOT" },
        orderBy: [{ competitionId: "asc" }, { slotId: "asc" }],
        select: { relativeToPar: true },
      })).map((row) => row.relativeToPar);

    const a = await scoresFor(one.cohort.id);
    expect(a).toHaveLength(76); // 19 bots × 4 events
    expect(a.every((value) => value !== null)).toBe(true);
    // Different Journeys ⇒ different seed namespaces ⇒ different fields.
    expect(a).not.toEqual(await scoresFor(two.cohort.id));
  });
});

describe("No calendar gates anything", () => {
  it("makes all four events immediately playable with no unlock day", async () => {
    const user = await newUser("playable");
    const state = await startCareerJourney(db, user.id, OPTS);

    const competitions = await db.careerCompetition.findMany({
      where: { cohortId: state.cohort.id },
      orderBy: { eventNumber: "asc" },
    });
    expect(competitions.map((c) => c.state)).toEqual(["ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE"]);
    // Never expires, and nothing is scheduled for the future.
    for (const competition of competitions) {
      expect(competition.deadlineAt.getTime()).toBe(CAREER_NO_DEADLINE.getTime());
      expect(competition.unlocksAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("lets the player start any event straight away, including the last one", async () => {
    const user = await newUser("anyorder");
    const state = await startCareerJourney(db, user.id, OPTS);
    const fourth = state.competitions.find((c) => c.eventNumber === 4)!;
    const second = state.competitions.find((c) => c.eventNumber === 2)!;

    // Event 4 before event 1 — order is entirely the player's choice.
    const started = await startCareerEventRound(db, user.id, fourth.id);
    expect(started.ok).toBe(true);
    const alsoSecond = await startCareerEventRound(db, user.id, second.id);
    expect(alsoSecond.ok).toBe(true);
  });

  it("resumes the same round rather than rerolling a started event", async () => {
    const user = await newUser("resume");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];

    const a = await startCareerEventRound(db, user.id, first.id);
    const b = await startCareerEventRound(db, user.id, first.id);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("expected both starts to succeed");
    expect(b.roundId).toBe(a.roundId);
    expect(await db.round.count({ where: { userId: user.id, mode: "career" } })).toBe(1);

    // The seed is bound to the locked field, not to the request.
    const round = await db.round.findUniqueOrThrow({ where: { id: a.roundId } });
    expect(round.seedKey).toContain(careerJourneyKey(user.id));
  });
});
