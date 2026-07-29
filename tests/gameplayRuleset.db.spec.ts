import { execFileSync } from "node:child_process";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { officialDailyRuleset } from "@/lib/gameplayRuleset.server";
import {
  CURRENT_STANDARD_RULESET,
  STANDARD_V1_RULESET,
  STANDARD_V2_RULESET,
} from "@/lib/engine/rulesets";
import { startOrResumeChallengeRound } from "@/lib/challenge";

let admin: PrismaClient;
let db: PrismaClient;
let testSchema: string;
let courseId: string;
let userId: string;

function schemaUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

beforeAll(async () => {
  const baseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");

  testSchema = `career_test_gameplay_ruleset_${process.pid}_${Date.now()}`
    .replace(/[^a-zA-Z0-9_]/g, "_");
  admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${testSchema}"`);

  const testUrl = schemaUrl(baseUrl, testSchema);
  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
    stdio: "pipe",
  });
  db = new PrismaClient({ datasources: { db: { url: testUrl } } });

  const course = await db.course.create({
    data: {
      slug: "ruleset-test",
      name: "Ruleset Test",
      location: "Test",
      rating: 72,
      slope: 120,
      difficulty: 5,
      wind: 8,
      greens: "Medium",
    },
  });
  const user = await db.user.create({
    data: {
      guestId: `ruleset-${Date.now()}`,
      username: "Ruleset Tester",
    },
  });
  courseId = course.id;
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (admin && testSchema) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
  }
  await admin?.$disconnect();
});

describe("gameplay ruleset persistence migration", () => {
  it("uses standard-v1 as the deterministic safe default for historical rows", async () => {
    const round = await db.round.create({
      data: {
        userId,
        courseId,
        mode: "unlimited",
      },
    });
    const challenge = await db.challenge.create({
      data: {
        challengerId: userId,
        opponentId: userId,
        courseId,
        seedKey: "historical",
      },
    });
    const tournament = await db.tournament.create({
      data: {
        weekKey: "ruleset-historical",
        courseId,
        startsAt: new Date("2026-07-01T00:00:00Z"),
        cutAt: new Date("2026-07-03T00:00:00Z"),
        endsAt: new Date("2026-07-06T00:00:00Z"),
      },
    });

    expect(round.rulesetVersion).toBe(STANDARD_V1_RULESET);
    expect(challenge.rulesetVersion).toBe(STANDARD_V1_RULESET);
    expect(tournament.rulesetVersion).toBe(STANDARD_V1_RULESET);
  });

  it("keeps explicitly stored v1 and v2 rounds immutable across reads", async () => {
    const [v1, v2] = await Promise.all([
      db.round.create({
        data: {
          userId,
          courseId,
          mode: "unlimited",
          rulesetVersion: STANDARD_V1_RULESET,
        },
      }),
      db.round.create({
        data: {
          userId,
          courseId,
          mode: "unlimited",
          rulesetVersion: STANDARD_V2_RULESET,
        },
      }),
    ]);

    expect((await db.round.findUniqueOrThrow({ where: { id: v1.id } })).rulesetVersion)
      .toBe(STANDARD_V1_RULESET);
    expect((await db.round.findUniqueOrThrow({ where: { id: v2.id } })).rulesetVersion)
      .toBe(STANDARD_V2_RULESET);
  });

  it("inherits a historical Daily day and pins a new Daily day to the current ruleset", async () => {
    const historicalKey = "2026-07-27";
    await db.round.create({
      data: {
        userId,
        courseId,
        mode: "daily",
        dateKey: historicalKey,
        rulesetVersion: STANDARD_V1_RULESET,
      },
    });
    expect(await officialDailyRuleset(db, historicalKey)).toBe(STANDARD_V1_RULESET);
    expect((await db.dailyRulesetPin.findUniqueOrThrow({
      where: { dateKey: historicalKey },
    })).rulesetVersion).toBe(STANDARD_V1_RULESET);

    // A day with no pin takes whatever is current, and keeps it thereafter —
    // asserted against CURRENT_STANDARD_RULESET so a future bump does not
    // silently need this test edited to keep passing.
    const newKey = "2026-07-28";
    expect(await officialDailyRuleset(db, newKey)).toBe(CURRENT_STANDARD_RULESET);
    expect(await officialDailyRuleset(db, newKey)).toBe(CURRENT_STANDARD_RULESET);
  });

  it("copies one Challenge ruleset to both players and resumes without rerolling", async () => {
    const opponent = await db.user.create({
      data: {
        guestId: `ruleset-opponent-${Date.now()}`,
        username: "Ruleset Opponent",
      },
    });
    const challenge = await db.challenge.create({
      data: {
        challengerId: userId,
        opponentId: opponent.id,
        courseId,
        seedKey: "challenge-ruleset-pin",
        rulesetVersion: STANDARD_V2_RULESET,
      },
    });

    const first = await startOrResumeChallengeRound(userId, challenge.id, db);
    const retry = await startOrResumeChallengeRound(userId, challenge.id, db);
    const other = await startOrResumeChallengeRound(opponent.id, challenge.id, db);
    expect(first.ok && retry.ok && other.ok).toBe(true);
    if (!first.ok || !retry.ok || !other.ok) {
      throw new Error("expected Challenge starts to succeed");
    }
    expect(retry.roundId).toBe(first.roundId);

    const rounds = await db.round.findMany({
      where: { id: { in: [first.roundId, other.roundId] } },
      orderBy: { id: "asc" },
    });
    expect(rounds).toHaveLength(2);
    expect(rounds.every((round) =>
      round.rulesetVersion === STANDARD_V2_RULESET
      && round.seedKey === challenge.seedKey
    )).toBe(true);

    await db.round.update({
      where: { id: first.roundId },
      data: { rulesetVersion: STANDARD_V1_RULESET },
    });
    expect(await startOrResumeChallengeRound(userId, challenge.id, db)).toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});
