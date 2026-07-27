import { execFileSync } from "node:child_process";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COURSES } from "@/data/courses";
import { advanceCareerAfterFinish, startCareerJourney } from "@/lib/career/journey";
import { finishCareerRound, startCareerEventRound } from "@/lib/career/eventPlay";
import {
  careerEventLeaderboard,
  careerSeasonStandings,
  careerSeasonTable,
} from "@/lib/career/read";
import { careerLegacyForUser } from "@/lib/career/legacy";
import { rebuildCareerBotRounds } from "@/lib/career/botRounds";

/**
 * Career visibility — the season table, the round-by-round event leaderboard,
 * the immutable bot round cards behind it, and the Legacy ledger.
 *
 * Real PostgreSQL, disposable schema. Every assertion here is about what a
 * player is allowed to SEE and when; none of it may change a stored score.
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
    data: { guestId: `vis-${label}-${userSeq}-${Date.now()}`, username: `Vis ${label}` },
  });
}

/**
 * Bots shoot +5 per round, so a four-round bot event total is +20 and each
 * cumulative checkpoint is a clean multiple of five. That makes "revealed
 * through round N" verifiable by arithmetic rather than by eyeballing.
 */
const OPTS = { runtimeRevision: "career-visibility-test", simulateBotRound: () => 5 } as const;

/** Play exactly one numbered round of an event at the given score. */
async function playRound(
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

/** Play all four rounds of an event; the first carries the score. */
async function playEvent(
  userId: string,
  competitionId: string,
  relativeToPar: number,
): Promise<Awaited<ReturnType<typeof advanceCareerAfterFinish>>> {
  let advanced;
  for (const roundScore of [relativeToPar, 0, 0, 0]) {
    advanced = await playRound(userId, competitionId, roundScore);
  }
  return advanced!;
}

beforeAll(async () => {
  const baseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required for Career PostgreSQL tests");

  testSchema = `career_test_vis_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, "_");
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

describe("Immutable bot round cards", () => {
  it("stores one card per bot per round and sums them to the locked event total", async () => {
    const user = await newUser("cards");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];

    const cards = await db.careerBotRoundResult.findMany({
      where: { competitionId: first.id },
      orderBy: [{ slotId: "asc" }, { roundNumber: "asc" }],
    });
    // Nineteen bots × four rounds. The human's card is never pre-generated.
    expect(cards).toHaveLength(19 * 4);
    expect(new Set(cards.map((card) => `${card.slotId}:${card.roundNumber}`)).size).toBe(19 * 4);

    const totals = await db.careerResult.findMany({
      where: { competitionId: first.id, competitorType: "BOT" },
      select: { slotId: true, relativeToPar: true },
    });
    expect(totals).toHaveLength(19);
    for (const total of totals) {
      const sum = cards
        .filter((card) => card.slotId === total.slotId)
        .reduce((running, card) => running + card.relativeToPar, 0);
      expect(sum).toBe(total.relativeToPar);
    }
  });

  it("rejects a duplicate card at the database level", async () => {
    const user = await newUser("dupe-card");
    const state = await startCareerJourney(db, user.id, OPTS);
    const existing = await db.careerBotRoundResult.findFirstOrThrow({
      where: { competitionId: state.competitions[0].id },
    });
    await expect(db.careerBotRoundResult.create({
      data: {
        competitionId: existing.competitionId,
        lockRevisionId: existing.lockRevisionId,
        slotId: existing.slotId,
        roundNumber: existing.roundNumber,
        relativeToPar: 99,
        seed: "duplicate",
        formulaVersion: "duplicate",
      },
    })).rejects.toThrow();
  });

  it("reconstructs the same cards deterministically from the pinned lock", async () => {
    const user = await newUser("rebuild");
    // The real simulator, so reconstruction exercises the pinned formula path.
    const state = await startCareerJourney(db, user.id, { runtimeRevision: "career-visibility-test" });
    const first = state.competitions[0];

    const rebuilt = await rebuildCareerBotRounds(db, first.id);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.verified).toBe(true);
    expect(rebuilt!.slots).toHaveLength(19);

    const stored = await db.careerBotRoundResult.findMany({
      where: { competitionId: first.id },
      orderBy: [{ slotId: "asc" }, { roundNumber: "asc" }],
    });
    for (const slot of rebuilt!.slots) {
      for (const card of slot.cards) {
        const match = stored.find(
          (row) => row.slotId === slot.slotId && row.roundNumber === card.roundNumber,
        );
        expect(match?.relativeToPar).toBe(card.relativeToPar);
        expect(match?.seed).toBe(card.seed);
      }
    }
    // Rebuilding twice is byte-identical — nothing is sampled at read time.
    const again = await rebuildCareerBotRounds(db, first.id);
    expect(again!.slots.map((slot) => slot.cards.map((card) => card.relativeToPar)))
      .toEqual(rebuilt!.slots.map((slot) => slot.cards.map((card) => card.relativeToPar)));
  }, 60_000);
});

describe("Round-by-round event leaderboard", () => {
  it("reveals exactly through the round the player has completed", async () => {
    const user = await newUser("rounds");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];

    const before = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(before!.revealed).toBe(false);
    expect(before!.roundsRevealed).toBe(0);
    expect(before!.standings).toHaveLength(20);
    expect(before!.standings.every((row) => row.relativeToPar === null)).toBe(true);

    for (const round of [1, 2, 3]) {
      // Starting a round must not reveal it: only finishing does.
      const started = await startCareerEventRound(db, user.id, first.id);
      if (!started.ok) throw new Error("start failed");
      const midRound = await careerEventLeaderboard(db, first.id, state.profile.id);
      expect(midRound!.roundsRevealed).toBe(round - 1);

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
        data: { score: 70, relativeToPar: -2 },
      });
      const finished = await finishCareerRound(db, started.roundId, user.id, 120_000);
      if (!finished.ok) throw new Error("finish failed");
      await advanceCareerAfterFinish(db, first.id, OPTS);

      const board = await careerEventLeaderboard(db, first.id, state.profile.id);
      expect(board!.roundsRevealed).toBe(round);
      expect(board!.revealed).toBe(true);
      expect(board!.settled).toBe(false);
      expect(board!.standings).toHaveLength(20);
      // Bots are +5 a round, the player -2: every visible number is cumulative
      // through this round and nothing later has leaked.
      const bots = board!.standings.filter((row) => row.competitorType === "BOT");
      expect(bots.every((row) => row.relativeToPar === 5 * round)).toBe(true);
      const me = board!.standings.find((row) => row.isMe)!;
      expect(me.relativeToPar).toBe(-2 * round);
      expect(me.rank).toBe(1);
      expect(board!.standings.every((row) => row.roundsCompleted === round)).toBe(true);
      expect(board!.standings.every((row) => row.points === null)).toBe(true);
    }

    await playRound(user.id, first.id, -2);
    const complete = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(complete!.roundsRevealed).toBe(4);
    expect(complete!.settled).toBe(true);

    // The revealed totals are the immutable event final, not a recomputation.
    const final = await db.careerEventFinal.findFirstOrThrow({ where: { competitionId: first.id } });
    const standings = final.standings as Array<{
      slotId: number;
      relativeToPar: number | null;
      rank: number | null;
      points: number;
    }>;
    for (const row of complete!.standings) {
      const authority = standings.find((entry) => entry.slotId === row.slotId)!;
      expect(row.relativeToPar).toBe(authority.relativeToPar);
      expect(row.rank).toBe(authority.rank);
      expect(row.points).toBe(authority.points);
    }
    expect(complete!.standings.find((row) => row.isMe)!.relativeToPar).toBe(-8);
    expect(complete!.standings.filter((row) => row.competitorType === "BOT")
      .every((row) => row.relativeToPar === 20)).toBe(true);
  }, 60_000);

  it("keeps a multi-round event sealed when its bot cards were never stored", async () => {
    const user = await newUser("nocards");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];
    // Simulate an event formed before per-round cards existed.
    await db.careerBotRoundResult.deleteMany({ where: { competitionId: first.id } });

    await playRound(user.id, first.id, -3);
    const partial = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(partial!.revealed).toBe(false);
    expect(partial!.roundCardsAvailable).toBe(false);
    expect(partial!.standings).toHaveLength(20);
    expect(partial!.standings.every((row) => row.relativeToPar === null)).toBe(true);

    // The locked totals are untouched, so completing the event still works and
    // still publishes the exact immutable final.
    for (const score of [0, 0, 0]) await playRound(user.id, first.id, score);
    const complete = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(complete!.revealed).toBe(true);
    expect(complete!.settled).toBe(true);
    expect(complete!.standings.filter((row) => row.competitorType === "BOT")
      .every((row) => row.relativeToPar === 20)).toBe(true);
  }, 60_000);

  it("still works for a grandfathered one-round event", async () => {
    const user = await newUser("legacy-format");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];
    // Rewrite this event to the original one-card contract, exactly as an
    // in-progress season formed before four-round events would be.
    await db.careerCompetition.update({
      where: { id: first.id },
      data: { roundsPerPlayer: 1 },
    });
    await db.careerBotRoundResult.deleteMany({ where: { competitionId: first.id } });

    const hidden = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(hidden!.roundsRevealed).toBe(0);
    expect(hidden!.competition.roundsPerPlayer).toBe(1);

    await playRound(user.id, first.id, -5);
    const shown = await careerEventLeaderboard(db, first.id, state.profile.id);
    expect(shown!.revealed).toBe(true);
    expect(shown!.roundsRevealed).toBe(1);
    expect(shown!.settled).toBe(true);
    expect(shown!.standings).toHaveLength(20);
    expect(shown!.standings.find((row) => row.isMe)!.rank).toBe(1);
  });
});

describe("Live season standings", () => {
  it("lists the whole field before a single card is played", async () => {
    const user = await newUser("preseason");
    const state = await startCareerJourney(db, user.id, OPTS);

    const table = await careerSeasonTable(db, state.cohort.id, state.profile.id);
    expect(table).not.toBeNull();
    expect(table!.standings).toHaveLength(20);
    expect(table!.eventsRevealed).toBe(0);
    expect(table!.eventsTotal).toBe(4);
    expect(table!.settled).toBe(false);
    // No competitive result exists, so there is no rank to invent.
    expect(table!.standings.every((row) => row.rank === null)).toBe(true);
    expect(table!.standings.every((row) => row.seasonPoints === 0)).toBe(true);
    expect(table!.standings.every((row) => row.eventsCompleted === 0)).toBe(true);
    expect(table!.standings.filter((row) => row.isMe)).toHaveLength(1);
    expect(table!.standings.every((row) => row.displayName.length > 0)).toBe(true);
    // Every event cell is present but unrevealed and carries no score.
    for (const row of table!.standings) {
      expect(row.events).toHaveLength(4);
      expect(row.events.every((cell) => !cell.revealed)).toBe(true);
      expect(row.events.every((cell) => cell.points === null)).toBe(true);
      expect(row.events.every((cell) => cell.relativeToPar === null)).toBe(true);
    }
  });

  it("does not reveal an event until the player has completed all its rounds", async () => {
    const user = await newUser("frontier");
    const state = await startCareerJourney(db, user.id, OPTS);
    const first = state.competitions[0];

    for (const round of [1, 2, 3]) {
      await playRound(user.id, first.id, -2);
      const table = await careerSeasonTable(db, state.cohort.id, state.profile.id);
      expect(table!.eventsRevealed, `after round ${round}`).toBe(0);
      expect(table!.standings.every((row) => row.rank === null)).toBe(true);
    }
    await playRound(user.id, first.id, -2);
    const table = await careerSeasonTable(db, state.cohort.id, state.profile.id);
    expect(table!.eventsRevealed).toBe(1);
  }, 60_000);

  it("advances the frontier one event at a time and never scores a hidden event", async () => {
    const user = await newUser("provisional");
    const state = await startCareerJourney(db, user.id, OPTS);
    const events = state.competitions;

    // Event 1: a win.
    await playEvent(user.id, events[0].id, -6);
    let table = (await careerSeasonTable(db, state.cohort.id, state.profile.id))!;
    expect(table.eventsRevealed).toBe(1);
    expect(table.events.filter((event) => event.revealed)).toHaveLength(1);
    expect(table.events[0].revealed).toBe(true);
    let me = table.standings.find((row) => row.isMe)!;
    expect(me.rank).toBe(1);
    expect(me.seasonPoints).toBe(100);
    expect(me.events[0]).toMatchObject({ revealed: true, rank: 1, points: 100, counting: true });
    // Events 2-4 are absent from the maths entirely — not scored as zero.
    expect(me.events.slice(1).every((cell) => !cell.revealed && cell.points === null)).toBe(true);
    expect(me.events.slice(1).every((cell) => !cell.counting)).toBe(true);
    // The frontier applies to the rivals too, so nobody is scored on more.
    expect(table.standings.every((row) =>
      row.events.filter((cell) => cell.revealed).length === 1)).toBe(true);

    // Event 2: a blow-up. It must not be able to drag the player below rivals
    // who are still only scored on the same two events.
    await playEvent(user.id, events[1].id, 30);
    table = (await careerSeasonTable(db, state.cohort.id, state.profile.id))!;
    expect(table.eventsRevealed).toBe(2);
    me = table.standings.find((row) => row.isMe)!;
    expect(me.events[1]).toMatchObject({ revealed: true, counting: true });
    // Best three of two revealed events = both of them.
    expect(me.seasonPoints).toBe(me.events[0].points! + me.events[1].points!);

    // Event 3: another win.
    await playEvent(user.id, events[2].id, -6);
    table = (await careerSeasonTable(db, state.cohort.id, state.profile.id))!;
    expect(table.eventsRevealed).toBe(3);
    me = table.standings.find((row) => row.isMe)!;
    expect(me.rank).toBe(1);
    expect(me.events[3].revealed).toBe(false);
    expect(me.events.filter((cell) => cell.counting)).toHaveLength(3);

    // Event 4: the last win. Best three now DROP the blow-up.
    await playEvent(user.id, events[3].id, -6);
    table = (await careerSeasonTable(db, state.cohort.id, state.profile.id))!;
    expect(table.eventsRevealed).toBe(4);
    expect(table.settled).toBe(true);
    me = table.standings.find((row) => row.isMe)!;
    expect(me.seasonPoints).toBe(300);
    expect(me.events[1].counting).toBe(false);
    expect(me.events.filter((cell) => cell.counting)).toHaveLength(3);

    // The displayed table matches the immutable final standings exactly.
    const immutable = await careerSeasonStandings(db, state.cohort.id);
    expect(immutable).toHaveLength(20);
    expect(table.standings.map((row) => row.competitorId))
      .toEqual(immutable.map((row) => row.competitorId));
    expect(table.standings.map((row) => row.rank)).toEqual(immutable.map((row) => row.rank));
    expect(table.standings.map((row) => row.seasonPoints))
      .toEqual(immutable.map((row) => row.seasonPoints));
    expect(me.movement).toBe(immutable.find((row) => row.profileId === state.profile.id)!.movement);
  }, 120_000);

  it("keeps a settled season readable after the next one opens", async () => {
    const user = await newUser("history");
    const state = await startCareerJourney(db, user.id, OPTS);
    for (const competition of state.competitions) {
      await playEvent(user.id, competition.id, -4);
    }
    const table = (await careerSeasonTable(db, state.cohort.id, state.profile.id))!;
    expect(table.settled).toBe(true);
    expect(table.seasonNumber).toBe(1);
    expect(table.standings.find((row) => row.isMe)!.rank).toBe(1);
    expect(await careerSeasonStandings(db, state.cohort.id)).toHaveLength(20);
  }, 120_000);
});

describe("Legacy ledger", () => {
  it("reconciles to the profile total with readable, ordered entries", async () => {
    const user = await newUser("legacy");
    const state = await startCareerJourney(db, user.id, OPTS);
    for (const competition of state.competitions) {
      await playEvent(user.id, competition.id, -4);
    }

    const view = await careerLegacyForUser(db, user.id);
    expect(view).not.toBeNull();
    expect(view!.entries.length).toBeGreaterThan(0);
    expect(view!.ledgerTotal).toBe(view!.legacyTotal);
    expect(view!.reconciles).toBe(true);
    expect(view!.invariantViolations).toEqual([]);

    // The running balance is a real reconciliation of the displayed total.
    expect(view!.entries.at(-1)!.runningTotal).toBe(view!.ledgerTotal);
    let running = 0;
    for (const entry of view!.entries) {
      running += entry.points;
      expect(entry.runningTotal).toBe(running);
      expect(entry.points).toBeGreaterThan(0);
      expect(entry.label).not.toMatch(/[A-Z][a-z]+[A-Z]/); // never a raw camelCase key
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.context).not.toBeNull();
    }
    expect(view!.entries.some((entry) => entry.awardType === "eventWin")).toBe(true);
    expect(view!.entries.some((entry) => entry.context?.includes("Season 1"))).toBe(true);

    // Deterministic order: the same read twice is the same list.
    const again = await careerLegacyForUser(db, user.id);
    expect(again!.entries.map((entry) => entry.id))
      .toEqual(view!.entries.map((entry) => entry.id));
    expect(view!.title.title.length).toBeGreaterThan(0);
  }, 120_000);

  it("is account-scoped and cannot be read through another player's id", async () => {
    const mine = await newUser("legacy-mine");
    const theirs = await newUser("legacy-theirs");
    const state = await startCareerJourney(db, mine.id, OPTS);
    await startCareerJourney(db, theirs.id, OPTS);
    await playEvent(mine.id, state.competitions[0].id, -4);
    await playEvent(mine.id, state.competitions[1].id, -4);
    await playEvent(mine.id, state.competitions[2].id, -4);
    await playEvent(mine.id, state.competitions[3].id, -4);

    const ownView = await careerLegacyForUser(db, mine.id);
    expect(ownView!.entries.length).toBeGreaterThan(0);

    // The other player's read resolves THEIR profile from THEIR session; there
    // is no parameter that could point it at someone else's ledger.
    const otherView = await careerLegacyForUser(db, theirs.id);
    expect(otherView!.profileId).not.toBe(ownView!.profileId);
    expect(otherView!.entries).toHaveLength(0);
    expect(otherView!.legacyTotal).toBe(0);
  }, 120_000);

  it("writes nothing, and settlement retries create no duplicate rows", async () => {
    const user = await newUser("legacy-idempotent");
    const state = await startCareerJourney(db, user.id, OPTS);
    for (const competition of state.competitions) {
      await playEvent(user.id, competition.id, -4);
    }
    // Re-running the advance is the retry path the scheduler uses.
    for (const competition of state.competitions) {
      await advanceCareerAfterFinish(db, competition.id, OPTS);
    }

    const rows = await db.careerLegacyLedger.findMany({
      where: { profileId: state.profile.id },
      select: { sourceType: true, sourceId: true, awardType: true },
    });
    const keys = rows.map((row) => `${row.sourceType}:${row.sourceId}:${row.awardType}`);
    expect(new Set(keys).size).toBe(keys.length);

    const before = await db.careerLegacyLedger.count({ where: { profileId: state.profile.id } });
    const view = await careerLegacyForUser(db, user.id);
    await careerLegacyForUser(db, user.id);
    await careerLegacyForUser(db, user.id);
    const after = await db.careerLegacyLedger.count({ where: { profileId: state.profile.id } });
    expect(after).toBe(before);
    expect(view!.reconciles).toBe(true);
  }, 120_000);

  it("surfaces a negative row honestly instead of hiding it", async () => {
    const user = await newUser("legacy-invariant");
    const state = await startCareerJourney(db, user.id, OPTS);
    await playEvent(user.id, state.competitions[0].id, -4);
    // Legacy never decreases by design; if data ever broke that rule the view
    // must report it rather than quietly dropping the row.
    await db.careerLegacyLedger.create({
      data: {
        profileId: state.profile.id,
        sourceType: "season",
        sourceId: state.cohort.id,
        awardType: "impossiblePenalty",
        points: -25,
        revisionId: "test-invariant",
        payloadHash: "test-invariant",
      },
    });

    const view = await careerLegacyForUser(db, user.id);
    expect(view!.invariantViolations).toHaveLength(1);
    expect(view!.invariantViolations[0]).toContain("never decreases");
    const shown = view!.entries.find((entry) => entry.awardType === "impossiblePenalty")!;
    expect(shown.points).toBe(-25);
    // An unknown award type still renders as words, not as a raw key.
    expect(shown.label).toBe("Impossible penalty");
    expect(shown.reason.length).toBeGreaterThan(0);
  }, 60_000);
});
