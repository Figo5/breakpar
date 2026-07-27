/**
 * Career Mode — settlement ENGINE on real PostgreSQL.
 *
 * Scope is deliberately narrow: claims, leases, fencing tokens, snapshots,
 * staging, atomic publication, retries, and MANUAL_REVIEW — exercised against
 * bare aggregates, independent of any particular Career cadence.
 *
 * The player-paced LIFECYCLE is covered by the specs that own it:
 *   - tests/careerJourney.db.spec.ts      Journey + instant field formation
 *   - tests/careerSeason.db.spec.ts       completion-driven event/season settlement
 *   - tests/careerChampionship.db.spec.ts Championship unlock, play, settlement
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  CareerAggregateType,
  PrismaClient,
  type Course,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { careerEffectKey } from "@/lib/career/effectKeys";
import { CAREER_FORMULA_VERSION } from "@/lib/career/formulaBundle";
import {
  CareerSettlementEngine,
  SettlementConflictError,
  SettlementFenceError,
  SettlementStateError,
  type ClaimSettlementResult,
  type SettlementAggregateRef,
  type SettlementClaim,
  type SettlementEffect,
} from "@/lib/career/settlementEngine";
import { COURSES } from "@/data/courses";

let admin: PrismaClient;
let db: PrismaClient;
let engine: CareerSettlementEngine;
let course: Course;
let testSchema: string;

function schemaUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function claimed(result: ClaimSettlementResult): SettlementClaim {
  expect(result.status).toBe("claimed");
  if (result.status !== "claimed") throw new Error(`Expected claim, received ${result.status}`);
  return result.claim;
}

async function createEndedEvent(label: string): Promise<SettlementAggregateRef> {
  const competition = await db.careerCompetition.create({
    data: {
      kind: "EVENT",
      courseId: course.id,
      state: "ENDED",
      unlocksAt: new Date(Date.now() - 120_000),
      deadlineAt: new Date(Date.now() - 60_000),
      targetFieldSize: 20,
    },
  });
  return { type: "EVENT", id: competition.id };
}

async function claimEvent(
  label: string,
  owner = `worker-${label}`,
  leaseMs = 60_000,
): Promise<SettlementClaim> {
  const aggregate = await createEndedEvent(label);
  return claimed(await engine.claim({
    aggregate,
    owner,
    trigger: "manual",
    codeRevision: "career-db-test",
    leaseMs,
  }));
}

async function snapshot(
  claim: SettlementClaim,
  marker = "default",
): Promise<void> {
  await engine.snapshot(claim, {
    input: {
      aggregateId: claim.aggregate.id,
      marker,
      terminalResults: [],
    },
    formulaVersion: CAREER_FORMULA_VERSION,
    runtimeRevision: "career-db-test",
  });
}

async function revisionFor(claim: SettlementClaim): Promise<string> {
  const attempt = await db.careerSettlementAttempt.findUniqueOrThrow({
    where: { id: claim.attemptId },
    select: { inputHash: true },
  });
  if (!attempt.inputHash) throw new Error("Settlement snapshot has no input hash");
  return attempt.inputHash;
}

async function effectsFor(claim: SettlementClaim): Promise<SettlementEffect[]> {
  const revisionId = await revisionFor(claim);
  return [
    {
      effectKey: careerEffectKey.eventFinal(
        claim.aggregate.id,
        1,
        CAREER_FORMULA_VERSION,
      ),
      effectType: "event-final",
      scope: claim.aggregate.id,
      payload: { standings: [], winner: null },
    },
    {
      effectKey: careerEffectKey.outbox(
        revisionId,
        "settlement-ready",
        claim.aggregate.id,
      ),
      effectType: "settlement-ready",
      scope: claim.aggregate.id,
      payload: { aggregateId: claim.aggregate.id },
      isOutbox: true,
    },
  ];
}

async function calculate(
  claim: SettlementClaim,
  effects?: readonly SettlementEffect[],
): Promise<void> {
  const calculatedEffects = effects ?? await effectsFor(claim);
  await engine.calculateAndStage(
    claim,
    { aggregateId: claim.aggregate.id, status: "final" },
    calculatedEffects,
  );
}

beforeAll(async () => {
  const baseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required for Career PostgreSQL tests");

  testSchema = `career_test_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, "_");
  admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${testSchema}"`);

  const testUrl = schemaUrl(baseUrl, testSchema);
  execFileSync(
    path.resolve("node_modules/.bin/prisma"),
    ["migrate", "deploy"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        DIRECT_URL: testUrl,
      },
      stdio: "pipe",
    },
  );

  db = new PrismaClient({
    datasources: { db: { url: testUrl } },
    transactionOptions: {
      isolationLevel: "ReadCommitted",
      maxWait: 10_000,
      timeout: 20_000,
    },
  });
  engine = new CareerSettlementEngine(db);
  course = await db.course.create({
    data: {
      slug: "career-db-test",
      name: "Career DB Test",
      location: "Test",
      rating: 72,
      slope: 120,
      difficulty: 5,
      wind: 8,
      greens: "medium",
    },
  });
  await db.course.createMany({
    data: COURSES.slice(0, 4).map((entry) => ({
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

describe("Career settlement engine on PostgreSQL 16", () => {
  it("runs against PostgreSQL 16 with read-committed transactions", async () => {
    const rows = await db.$queryRaw<Array<{
      serverVersion: string;
      isolation: string;
    }>>`
      SELECT current_setting('server_version_num') AS "serverVersion",
             current_setting('transaction_isolation') AS "isolation"
    `;
    const serverVersion = Number(rows[0].serverVersion);
    expect(serverVersion).toBeGreaterThanOrEqual(160_000);
    expect(serverVersion).toBeLessThan(170_000);
    expect(rows[0].isolation).toBe("read committed");
  });

  it("installs and enforces every Career filtered unique index", async () => {
    const expectedIndexes = [
      "CareerSettlementAttempt_committed_unique",
      "CareerChampionshipSlot_profile_unique",
      "CareerChampionshipSlot_bot_unique",
    ] as const;
    const indexes = await db.$queryRawUnsafe<Array<{
      indexname: string;
      indexdef: string;
    }>>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = $1
         AND indexname = ANY($2::text[])
       ORDER BY indexname`,
      testSchema,
      [...expectedIndexes],
    );
    expect(indexes.map((index) => index.indexname).sort()).toEqual(
      [...expectedIndexes].sort(),
    );
    const definition = new Map(
      indexes.map((index) => [
        index.indexname,
        index.indexdef.replace(/\s+/g, " "),
      ]),
    );
    expect(definition.get("CareerSettlementAttempt_committed_unique")).toMatch(
      /CREATE UNIQUE INDEX .* ON .*"CareerSettlementAttempt".*\("aggregateType", "aggregateId"\).*WHERE.*state.*COMMITTED/i,
    );
    expect(definition.get("CareerChampionshipSlot_profile_unique")).toMatch(
      /CREATE UNIQUE INDEX .* ON .*"CareerChampionshipSlot".*\("championshipId", "profileId"\).*WHERE.*"profileId" IS NOT NULL/i,
    );
    expect(definition.get("CareerChampionshipSlot_bot_unique")).toMatch(
      /CREATE UNIQUE INDEX .* ON .*"CareerChampionshipSlot".*\("championshipId", "botIdentityId"\).*WHERE.*"botIdentityId" IS NOT NULL/i,
    );

    const leaseExpiresAt = new Date(Date.now() + 60_000);
    const aggregateId = "filtered-index-aggregate";
    await db.careerSettlementAttempt.createMany({
      data: [
        {
          aggregateType: "EVENT",
          aggregateId,
          fencingToken: 1,
          state: "FAILED_RETRYABLE",
          owner: "filtered-index-test",
          trigger: "manual",
          leaseExpiresAt,
        },
        {
          aggregateType: "EVENT",
          aggregateId,
          fencingToken: 2,
          state: "FAILED_RETRYABLE",
          owner: "filtered-index-test",
          trigger: "manual",
          leaseExpiresAt,
        },
      ],
    });
    await db.careerSettlementAttempt.create({
      data: {
        aggregateType: "EVENT",
        aggregateId,
        fencingToken: 3,
        state: "COMMITTED",
        owner: "filtered-index-test",
        trigger: "manual",
        leaseExpiresAt,
      },
    });
    await expect(db.careerSettlementAttempt.create({
      data: {
        aggregateType: "EVENT",
        aggregateId,
        fencingToken: 4,
        state: "COMMITTED",
        owner: "filtered-index-test",
        trigger: "manual",
        leaseExpiresAt,
      },
    })).rejects.toMatchObject({ code: "P2002" });

    const user = await db.user.create({
      data: {
        guestId: `filtered-index-${testSchema}`,
        username: "Filtered Index QA",
      },
    });
    const world = await db.careerWorld.create({
      data: { worldKey: `journey:${user.id}` },
    });
    const profile = await db.careerProfile.create({
      data: { userId: user.id, worldId: world.id },
    });
    const bot = await db.careerBotIdentity.create({
      data: {
        worldId: world.id,
        botKey: "filtered-index-bot",
        displayName: "Filtered Index Bot",
        homeFlavor: "constraint specialist",
        tendency: "BALANCED",
      },
    });
    const championship = await db.careerChampionship.create({
      data: {
        worldId: world.id,
        cycleNumber: 1,
        deadlineAt: new Date("9999-12-31T23:59:59.999Z"),
      },
    });
    await db.careerChampionshipSlot.create({
      data: {
        championshipId: championship.id,
        slotNumber: 1,
        competitorType: "HUMAN",
        profileId: profile.id,
        source: "cycle-qualifier",
        sourceTrace: {},
      },
    });
    await expect(db.careerChampionshipSlot.create({
      data: {
        championshipId: championship.id,
        slotNumber: 2,
        competitorType: "HUMAN",
        profileId: profile.id,
        source: "cycle-qualifier",
        sourceTrace: {},
      },
    })).rejects.toMatchObject({ code: "P2002" });

    await db.careerChampionshipSlot.create({
      data: {
        championshipId: championship.id,
        slotNumber: 3,
        competitorType: "BOT",
        botIdentityId: bot.id,
        source: "elite-bot",
        sourceTrace: {},
      },
    });
    await expect(db.careerChampionshipSlot.create({
      data: {
        championshipId: championship.id,
        slotNumber: 4,
        competitorType: "BOT",
        botIdentityId: bot.id,
        source: "elite-bot",
        sourceTrace: {},
      },
    })).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows exactly one of two concurrent workers to claim an aggregate", async () => {
    const aggregate = await createEndedEvent("concurrent-claim");
    const results = await Promise.all([
      engine.claim({
        aggregate,
        owner: "cron-worker",
        trigger: "cron",
        codeRevision: "test",
        leaseMs: 60_000,
      }),
      engine.claim({
        aggregate,
        owner: "read-repair-worker",
        trigger: "read-repair",
        codeRevision: "test",
        leaseMs: 60_000,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "already-claimed",
      "claimed",
    ]);
    expect(await db.careerSettlementAttempt.count({
      where: {
        aggregateType: "EVENT",
        aggregateId: aggregate.id,
      },
    })).toBe(1);
    expect((await db.careerCompetition.findUniqueOrThrow({
      where: { id: aggregate.id },
    })).fencingToken).toBe(1);
  });

  it("supports fenced claims for event, season, and Championship aggregates", async () => {
    const event = await createEndedEvent("aggregate-event");
    const world = await db.careerWorld.create({
      data: { worldKey: "2099-01-15" },
    });
    const cohort = await db.careerCohort.create({
      data: {
        worldId: world.id,
        seasonNumber: 1,
        tier: "LOCAL",
        state: "ENDED",
      },
    });
    const championship = await db.careerChampionship.create({
      data: {
        worldId: world.id,
        cycleNumber: 1,
        state: "ENDED",
        deadlineAt: new Date(Date.now() - 60_000),
      },
    });

    const refs: SettlementAggregateRef[] = [
      event,
      { type: "SEASON", id: cohort.id },
      { type: "CHAMPIONSHIP", id: championship.id },
    ];
    for (const aggregate of refs) {
      const result = await engine.claim({
        aggregate,
        owner: `worker-${aggregate.type}`,
        trigger: "manual",
        leaseMs: 60_000,
      });
      expect(result.status).toBe("claimed");
    }
  });

  it("renews both the aggregate and attempt lease with a fenced heartbeat", async () => {
    const claim = await claimEvent("heartbeat", "heartbeat-worker", 10_000);
    const renewed = await engine.heartbeat(claim, 60_000);
    const [competition, attempt] = await Promise.all([
      db.careerCompetition.findUniqueOrThrow({ where: { id: claim.aggregate.id } }),
      db.careerSettlementAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } }),
    ]);
    expect(competition.leaseExpiresAt?.getTime()).toBe(renewed.getTime());
    expect(attempt.leaseExpiresAt.getTime()).toBe(renewed.getTime());
  });

  it("supersedes an expired worker, reuses its immutable snapshot, and fences it from every write", async () => {
    const oldClaim = await claimEvent("stale-worker", "old-worker");
    await snapshot(oldClaim, "persist-me");
    await db.careerCompetition.update({
      where: { id: oldClaim.aggregate.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const replacement = claimed(await engine.claim({
      aggregate: oldClaim.aggregate,
      owner: "new-worker",
      trigger: "cron",
      codeRevision: "replacement",
      leaseMs: 60_000,
    }));
    expect(replacement.fencingToken).toBe(oldClaim.fencingToken + 1);
    expect(replacement.resumedSnapshot).toBe(true);
    await expect(engine.stageEffects(oldClaim, await effectsFor(oldClaim))).rejects.toBeInstanceOf(
      SettlementFenceError,
    );
    await expect(engine.heartbeat(oldClaim)).rejects.toBeInstanceOf(SettlementFenceError);

    const oldAttempt = await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: oldClaim.attemptId },
    });
    const newAttempt = await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: replacement.attemptId },
    });
    expect(oldAttempt.state).toBe("SUPERSEDED");
    expect(newAttempt.state).toBe("SNAPSHOTTED");
    expect(newAttempt.inputHash).toBe(oldAttempt.inputHash);
    expect(newAttempt.inputSnapshot).toEqual(oldAttempt.inputSnapshot);

    await calculate(replacement);
    expect((await engine.publish(replacement)).status).toBe("committed");
    await expect(engine.publish(oldClaim)).rejects.toBeInstanceOf(SettlementFenceError);
  });

  it("replays a calculated snapshot byte-for-byte after lease supersession", async () => {
    const oldClaim = await claimEvent("calculated-replay", "calculation-worker");
    await snapshot(oldClaim, "stable-calculation");
    await calculate(oldClaim);
    const oldAttemptBefore = await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: oldClaim.attemptId },
    });
    await db.careerCompetition.update({
      where: { id: oldClaim.aggregate.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const replacement = claimed(await engine.claim({
      aggregate: oldClaim.aggregate,
      owner: "replacement-calculation-worker",
      trigger: "cron",
      codeRevision: "new-build-same-formula",
      leaseMs: 60_000,
    }));
    expect(replacement.resumedSnapshot).toBe(true);
    await calculate(replacement);
    const replacementAttempt = await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: replacement.attemptId },
    });
    expect(replacementAttempt.inputHash).toBe(oldAttemptBefore.inputHash);
    expect(replacementAttempt.outputHash).toBe(oldAttemptBefore.outputHash);

    await engine.publish(replacement);
    const revisionId = await revisionFor(replacement);
    expect(await db.careerCommittedEffect.count({
      where: {
        aggregateId: replacement.aggregate.id,
        committedRevisionId: revisionId,
      },
    })).toBe(2);
    expect(await db.careerOutbox.count({
      where: { committedRevisionId: revisionId },
    })).toBe(1);
  });

  it("keeps partial staging invisible and safely verifies repeated batches", async () => {
    const claim = await claimEvent("partial-stage");
    await snapshot(claim);
    const effects = await effectsFor(claim);

    expect(await engine.stageEffects(claim, [effects[0]])).toEqual({
      inserted: 1,
      verified: 1,
    });
    expect(await engine.stageEffects(claim, [effects[0]])).toEqual({
      inserted: 0,
      verified: 1,
    });
    await expect(
      engine.finalizeCalculation(claim, { result: "incomplete" }, effects),
    ).rejects.toBeInstanceOf(SettlementStateError);
    expect(await db.careerStagedEffect.count({ where: { attemptId: claim.attemptId } })).toBe(1);
    expect(await db.careerCommittedEffect.count({
      where: { aggregateId: claim.aggregate.id },
    })).toBe(0);
    expect(await db.careerOutbox.count({
      where: { committedRevisionId: await revisionFor(claim) },
    })).toBe(0);
    expect((await db.careerCompetition.findUniqueOrThrow({
      where: { id: claim.aggregate.id },
    })).state).toBe("ENDED");

    await engine.stageEffects(claim, [effects[1]]);
    await engine.finalizeCalculation(claim, { result: "complete" }, effects);
    await engine.publish(claim);
    expect(await db.careerCommittedEffect.count({
      where: { aggregateId: claim.aggregate.id },
    })).toBe(2);
  });

  it("moves a reused effect key with different content to manual review", async () => {
    const claim = await claimEvent("payload-conflict");
    await snapshot(claim);
    const effect = (await effectsFor(claim))[0];
    await engine.stageEffects(claim, [effect]);
    await expect(engine.stageEffects(claim, [{
      ...effect,
      payload: { standings: [{ competitorId: "different" }], winner: null },
    }])).rejects.toBeInstanceOf(SettlementConflictError);

    expect((await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: claim.attemptId },
    })).state).toBe("MANUAL_REVIEW");
    expect((await db.careerCompetition.findUniqueOrThrow({
      where: { id: claim.aggregate.id },
    })).state).toBe("MANUAL_REVIEW");
    expect(await db.careerCommittedEffect.count({
      where: { aggregateId: claim.aggregate.id },
    })).toBe(0);
  });

  it("keeps input snapshots immutable and quarantines a changed retry", async () => {
    const claim = await claimEvent("input-mismatch");
    await snapshot(claim, "original");
    expect((await engine.snapshot(claim, {
      input: {
        aggregateId: claim.aggregate.id,
        marker: "original",
        terminalResults: [],
      },
      formulaVersion: CAREER_FORMULA_VERSION,
      runtimeRevision: "career-db-test",
    })).status).toBe("unchanged");

    await expect(snapshot(claim, "changed")).rejects.toBeInstanceOf(SettlementConflictError);
    expect((await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: claim.attemptId },
    })).state).toBe("MANUAL_REVIEW");
    expect((await db.careerCompetition.findUniqueOrThrow({
      where: { id: claim.aggregate.id },
    })).state).toBe("MANUAL_REVIEW");
  });

  it("replays identical calculations and quarantines deterministic output drift", async () => {
    const claim = await claimEvent("output-mismatch");
    await snapshot(claim);
    const effects = await effectsFor(claim);
    await engine.stageEffects(claim, effects);
    await engine.finalizeCalculation(
      claim,
      { aggregateId: claim.aggregate.id, status: "first" },
      effects,
    );
    expect((await engine.finalizeCalculation(
      claim,
      { aggregateId: claim.aggregate.id, status: "first" },
      effects,
    )).status).toBe("unchanged");

    await expect(engine.finalizeCalculation(
      claim,
      { aggregateId: claim.aggregate.id, status: "drifted" },
      effects,
    )).rejects.toBeInstanceOf(SettlementConflictError);
    expect((await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: claim.attemptId },
    })).state).toBe("MANUAL_REVIEW");
    expect(await db.careerCommittedEffect.count({
      where: { aggregateId: claim.aggregate.id },
    })).toBe(0);
  });

  it("rolls back every authoritative write when aggregate-specific publication fails", async () => {
    const claim = await claimEvent("atomic-rollback");
    await snapshot(claim);
    await calculate(claim);

    await expect(engine.publish(claim, {
      apply: async (tx) => {
        await tx.careerOperatorAudit.create({
          data: {
            actor: "fault-injector",
            command: "publish",
            aggregateType: CareerAggregateType.EVENT,
            aggregateId: claim.aggregate.id,
            reason: "must roll back",
          },
        });
        throw new Error("injected publication failure");
      },
    })).rejects.toThrow("injected publication failure");

    expect(await db.careerCommittedEffect.count({
      where: { aggregateId: claim.aggregate.id },
    })).toBe(0);
    expect(await db.careerOutbox.count({
      where: { committedRevisionId: await revisionFor(claim) },
    })).toBe(0);
    expect(await db.careerOperatorAudit.count({
      where: { aggregateId: claim.aggregate.id },
    })).toBe(0);
    expect((await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: claim.attemptId },
    })).state).toBe("CALCULATED");
    expect((await db.careerCompetition.findUniqueOrThrow({
      where: { id: claim.aggregate.id },
    })).state).toBe("ENDED");

    expect((await engine.publish(claim)).status).toBe("committed");
  });

  it("publishes concurrent retries exactly once with one outbox effect", async () => {
    const claim = await claimEvent("concurrent-publish");
    await snapshot(claim);
    await calculate(claim);

    const results = await Promise.all([
      engine.publish(claim),
      engine.publish(claim),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "already-settled",
      "committed",
    ]);
    expect(await db.careerCommittedEffect.count({
      where: { aggregateId: claim.aggregate.id },
    })).toBe(2);
    expect(await db.careerOutbox.count({
      where: { committedRevisionId: await revisionFor(claim) },
    })).toBe(1);
    expect(await db.careerSettlementAttempt.count({
      where: {
        aggregateType: "EVENT",
        aggregateId: claim.aggregate.id,
        state: "COMMITTED",
      },
    })).toBe(1);
  });

  it("treats an unknown-acknowledgement retry and later claim as already settled", async () => {
    const claim = await claimEvent("post-commit-retry");
    await snapshot(claim);
    await calculate(claim);
    const first = await engine.publish(claim);
    const retry = await engine.publish(claim);
    const newTrigger = await engine.claim({
      aggregate: claim.aggregate,
      owner: "late-trigger",
      trigger: "read-repair",
    });

    expect(first.status).toBe("committed");
    expect(retry).toEqual({
      status: "already-settled",
      committedAttemptId: claim.attemptId,
    });
    expect(newTrigger).toEqual({
      status: "already-settled",
      committedAttemptId: claim.attemptId,
    });
    expect(await db.careerSettlementAttempt.count({
      where: {
        aggregateType: "EVENT",
        aggregateId: claim.aggregate.id,
      },
    })).toBe(1);
  });

  it("reclaims an explicitly retryable attempt with a higher fence and the same snapshot", async () => {
    const first = await claimEvent("retryable", "first-worker");
    await snapshot(first, "retry-snapshot");
    await engine.markRetryable(first, "database-timeout", { phase: "calculation" });

    const second = claimed(await engine.claim({
      aggregate: first.aggregate,
      owner: "retry-worker",
      trigger: "cron",
      leaseMs: 60_000,
    }));
    expect(second.fencingToken).toBe(first.fencingToken + 1);
    expect(second.resumedSnapshot).toBe(true);
    expect((await db.careerSettlementAttempt.findUniqueOrThrow({
      where: { id: first.attemptId },
    })).state).toBe("FAILED_RETRYABLE");

    await calculate(second);
    await engine.publish(second);
    expect(await db.careerCommittedEffect.count({
      where: { aggregateId: second.aggregate.id },
    })).toBe(2);
  });

  it("database-enforces at most one committed revision per aggregate", async () => {
    const claim = await claimEvent("committed-unique");
    await snapshot(claim);
    await calculate(claim);
    await engine.publish(claim);

    await expect(db.careerSettlementAttempt.create({
      data: {
        aggregateType: "EVENT",
        aggregateId: claim.aggregate.id,
        fencingToken: claim.fencingToken + 1,
        state: "COMMITTED",
        owner: "corrupt-writer",
        trigger: "manual",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    })).rejects.toMatchObject({ code: "P2002" });
  });
});
