import { execFileSync } from "node:child_process";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COURSES } from "@/data/courses";
import { CAREER_NO_DEADLINE } from "@/lib/career/constants";
import {
  advanceCareerAfterFinish,
  advanceChampionshipAfterFinish,
  startCareerJourney,
} from "@/lib/career/journey";
import { finishCareerRound, startCareerEventRound } from "@/lib/career/eventPlay";
import {
  finishCareerChampionshipRound,
  startCareerChampionshipRound,
} from "@/lib/career/championshipPlay";

/**
 * Player-paced Career — Championship unlock, field, play, and settlement
 * (Iteration 5). Real PostgreSQL, disposable schema.
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
    data: { guestId: `champ-${label}-${userSeq}-${Date.now()}`, username: `Champ ${label}` },
  });
}

/** Regular-season bots shoot +5; Championship bots are overridden per test. */
const OPTS = { runtimeRevision: "career-champ-test", simulateBotRound: () => 5 } as const;

async function playRound(roundId: string, userId: string, relativeToPar: number): Promise<void> {
  await db.holeResult.createMany({
    data: Array.from({ length: 18 }, (_, index) => ({
      roundId,
      holeNumber: index + 1,
      decision: "normal",
      outcome: "par",
      scoreChange: 0,
    })),
  });
  await db.round.update({
    where: { id: roundId },
    data: { score: 72 + relativeToPar, relativeToPar },
  });
}

/** Play one regular event and advance the Career. */
async function playEvent(userId: string, competitionId: string, relativeToPar: number) {
  let advanced;
  for (const roundScore of [relativeToPar, 0, 0, 0]) {
    const started = await startCareerEventRound(db, userId, competitionId);
    if (!started.ok) throw new Error(`start failed: ${started.error}`);
    await playRound(started.roundId, userId, roundScore);
    const finished = await finishCareerRound(db, started.roundId, userId, 120_000);
    if (!finished.ok) throw new Error(`finish failed: ${finished.error}`);
    advanced = await advanceCareerAfterFinish(db, competitionId, OPTS);
  }
  return advanced!;
}

/**
 * Play `seasons` complete seasons at the given per-event score.
 * −6 wins every event (bots are +5) and promotes Local → Challenger → Pro;
 * +40 loses every event and holds the player at the Local floor.
 */
async function playSeasons(userId: string, seasons: number, relativeToPar: number) {
  let last;
  for (let season = 0; season < seasons; season++) {
    const state = await startCareerJourney(db, userId, OPTS);
    const events = await db.careerCompetition.findMany({
      where: { cohortId: state.cohort.id, kind: "EVENT" },
      orderBy: { eventNumber: "asc" },
    });
    for (const event of events) last = await playEvent(userId, event.id, relativeToPar);
  }
  return last!;
}

beforeAll(async () => {
  const baseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required for Career PostgreSQL tests");

  testSchema = `career_test_champ_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, "_");
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
  // Crown courses must be seeded alongside the regular rotation.
  const needed = new Set([
    "augusta-national", "st-andrews-old", "pinehurst-no2", "royal-birkdale",
    ...COURSES.slice(0, 8).map((entry) => entry.slug),
  ]);
  await db.course.createMany({
    data: COURSES.filter((entry) => needed.has(entry.slug)).map((entry) => ({
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

describe("Championship unlock", () => {
  it("unlocks after four settled seasons once the player has reached Challenger+", async () => {
    const user = await newUser("unlock");
    const advanced = await playSeasons(user.id, 4, -6);

    const profile = await db.careerProfile.findFirstOrThrow({ where: { userId: user.id } });
    expect(profile.settledSeasons).toBe(4);
    expect(["CHALLENGER", "PRO"]).toContain(profile.tier);

    const championships = await db.careerChampionship.findMany({
      where: { worldId: profile.worldId },
    });
    expect(championships).toHaveLength(1);
    expect(championships[0].cycleNumber).toBe(1);
    expect(championships[0].state).toBe("ACTIVE"); // field published
    expect(advanced.championshipId).toBe(championships[0].id);

    // The 35-point qualification award publishes with the fourth settlement.
    const qualification = await db.careerLegacyLedger.findMany({
      where: { profileId: profile.id, awardType: "championshipQualification" },
    });
    expect(qualification).toHaveLength(1);
    expect(qualification[0].points).toBe(35);
  });

  it("unlocks nothing for a player who completes a cycle at Local", async () => {
    const user = await newUser("local");
    await playSeasons(user.id, 4, 40); // loses every event; held at the Local floor

    const profile = await db.careerProfile.findFirstOrThrow({ where: { userId: user.id } });
    expect(profile.settledSeasons).toBe(4);
    expect(profile.tier).toBe("LOCAL");

    expect(await db.careerChampionship.count({ where: { worldId: profile.worldId } })).toBe(0);
    expect(await db.careerLegacyLedger.count({
      where: { profileId: profile.id, awardType: "championshipQualification" },
    })).toBe(0);
  });

  it("publishes a twenty-slot field of the player plus nineteen elite bots", async () => {
    const user = await newUser("field");
    await playSeasons(user.id, 4, -6);
    const profile = await db.careerProfile.findFirstOrThrow({ where: { userId: user.id } });
    const championship = await db.careerChampionship.findFirstOrThrow({
      where: { worldId: profile.worldId },
    });

    const slots = await db.careerChampionshipSlot.findMany({
      where: { championshipId: championship.id },
      orderBy: { slotNumber: "asc" },
    });
    expect(slots).toHaveLength(20);
    expect(slots[0]).toMatchObject({ slotNumber: 1, competitorType: "HUMAN", profileId: profile.id });
    expect(slots.slice(1).every((slot) => slot.competitorType === "BOT")).toBe(true);
    expect(new Set(slots.map((slot) => slot.botIdentityId ?? slot.profileId)).size).toBe(20);

    const competition = await db.careerCompetition.findFirstOrThrow({
      where: { championshipId: championship.id, kind: "CHAMPIONSHIP" },
      include: { course: true },
    });
    expect(competition.state).toBe("ACTIVE");
    // Playable immediately, never expires.
    expect(competition.deadlineAt.getTime()).toBe(CAREER_NO_DEADLINE.getTime());
    expect(["augusta-national", "st-andrews-old", "pinehurst-no2", "royal-birkdale"])
      .toContain(competition.course.slug);
  });

  it("never blocks the next regular season", async () => {
    const user = await newUser("nonblocking");
    await playSeasons(user.id, 4, -6);

    // Season 5 is present, playable, and independent of the Championship.
    const state = await startCareerJourney(db, user.id, OPTS);
    expect(state.cohort.seasonNumber).toBe(5);
    expect(state.cohort.state).toBe("ACTIVE");
    const events = await db.careerCompetition.findMany({
      where: { cohortId: state.cohort.id, kind: "EVENT" },
    });
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.state === "ACTIVE")).toBe(true);

    // And it stays playable while the Championship sits unplayed.
    const started = await startCareerEventRound(db, user.id, events[0].id);
    expect(started.ok).toBe(true);
  });
});

describe("Championship play and settlement", () => {
  async function unlockedChampionship(label: string) {
    const user = await newUser(label);
    await playSeasons(user.id, 4, -6);
    const profile = await db.careerProfile.findFirstOrThrow({ where: { userId: user.id } });
    const championship = await db.careerChampionship.findFirstOrThrow({
      where: { worldId: profile.worldId },
    });
    return { user, profile, championship };
  }

  it("stays available indefinitely and settles nothing while unplayed", async () => {
    const { championship, profile } = await unlockedChampionship("unplayed");

    // Nudging settlement does nothing: absence never settles.
    const advanced = await advanceChampionshipAfterFinish(db, championship.id, OPTS);
    expect(advanced.settled).toBe(false);
    const after = await db.careerChampionship.findUniqueOrThrow({ where: { id: championship.id } });
    expect(after.state).toBe("ACTIVE");
    expect(await db.careerLegacyLedger.count({
      where: { profileId: profile.id, awardType: "championshipWin" },
    })).toBe(0);
    // (Season-champion trophies from the four won seasons are expected; only the
    // Championship trophy must be absent.)
    expect(await db.careerTrophy.count({
      where: { profileId: profile.id, sourceId: championship.id },
    })).toBe(0);
  });

  it("awards the win and trophy when the player plays and wins", async () => {
    const { user, profile, championship } = await unlockedChampionship("win");
    const legacyBefore = profile.legacyTotal;
    expect(await db.careerLegacyLedger.count({
      where: { profileId: profile.id, awardType: "championshipQualification" },
    })).toBe(1);

    const started = await startCareerChampionshipRound(db, user.id, championship.id);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("start failed");
    // Beat the Ace field decisively.
    await playRound(started.roundId, user.id, -15);
    const finished = await finishCareerChampionshipRound(db, started.roundId, user.id, 120_000);
    expect(finished.ok).toBe(true);

    const advanced = await advanceChampionshipAfterFinish(db, championship.id, OPTS);
    expect(advanced.settled).toBe(true);

    const settled = await db.careerChampionship.findUniqueOrThrow({ where: { id: championship.id } });
    expect(settled.state).toBe("SETTLED");

    const results = await db.careerChampionshipResult.findMany({
      where: { championshipId: championship.id },
    });
    expect(results).toHaveLength(20);
    expect(results.filter((result) => result.isWinner)).toHaveLength(1);
    const winner = results.find((result) => result.isWinner)!;
    expect(winner.profileId).toBe(profile.id);
    expect(winner.rank).toBe(1);

    const win = await db.careerLegacyLedger.findMany({
      where: { profileId: profile.id, awardType: "championshipWin" },
    });
    expect(win).toHaveLength(1);
    expect(win[0].points).toBe(100);
    // Qualification published at unlock and must not be duplicated when the
    // Championship settles.
    expect(await db.careerLegacyLedger.count({
      where: { profileId: profile.id, awardType: "championshipQualification" },
    })).toBe(1);
    expect((await db.careerProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })).legacyTotal).toBe(legacyBefore + 100);
    expect(await db.careerTrophy.count({
      where: { profileId: profile.id, sourceId: championship.id },
    })).toBe(1);
  });

  it("permits one attempt and is idempotent under a repeated advance", async () => {
    const { user, championship } = await unlockedChampionship("oneattempt");
    const first = await startCareerChampionshipRound(db, user.id, championship.id);
    if (!first.ok) throw new Error("start failed");
    const second = await startCareerChampionshipRound(db, user.id, championship.id);
    expect(second).toEqual({ ok: true, roundId: first.roundId });
    expect(await db.round.count({
      where: { userId: user.id, careerChampionshipResult: { championshipId: championship.id } },
    })).toBe(1);

    await playRound(first.roundId, user.id, -12);
    await finishCareerChampionshipRound(db, first.roundId, user.id, 120_000);
    await advanceChampionshipAfterFinish(db, championship.id, OPTS);
    const again = await advanceChampionshipAfterFinish(db, championship.id, OPTS);
    expect(again.settled).toBe(false);

    // A settled Championship cannot be replayed.
    const replay = await startCareerChampionshipRound(db, user.id, championship.id);
    expect(replay.ok).toBe(false);
    expect(await db.careerLegacyLedger.count({
      where: { sourceId: championship.id, awardType: "championshipWin" },
    })).toBe(1);
  });

  it("emits no movement, rating, or season-history effects", async () => {
    const { user, profile, championship } = await unlockedChampionship("noeffects");
    const historyBefore = await db.careerSeasonHistory.count({ where: { profileId: profile.id } });
    const ratingsBefore = await db.careerRatingHistory.count({ where: { profileId: profile.id } });
    const tierBefore = profile.tier;
    const seasonBefore = profile.currentSeason;

    const started = await startCareerChampionshipRound(db, user.id, championship.id);
    if (!started.ok) throw new Error("start failed");
    await playRound(started.roundId, user.id, -15);
    await finishCareerChampionshipRound(db, started.roundId, user.id, 120_000);
    await advanceChampionshipAfterFinish(db, championship.id, OPTS);

    const after = await db.careerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(after.tier).toBe(tierBefore);
    expect(after.currentSeason).toBe(seasonBefore);
    expect(after.settledSeasons).toBe(4); // a Championship is not a season
    expect(await db.careerSeasonHistory.count({ where: { profileId: profile.id } }))
      .toBe(historyBefore);
    expect(await db.careerRatingHistory.count({ where: { profileId: profile.id } }))
      .toBe(ratingsBefore);
  });
});
