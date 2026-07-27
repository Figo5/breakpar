import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { COURSES, type Course as GameCourse } from "@/data/courses";
import { simulateArchetypeRound, type CareerArchetype } from "./simulator";
import { assignCareerBotSlots } from "./botRoster";
import {
  CAREER_CANONICAL_VERSION,
  canonicalHash,
  canonicalStringify,
  payloadHash,
} from "./canonical";
import { careerEffectKey } from "./effectKeys";
import {
  CAREER_FORMULA_VERSION,
  CAREER_CURRENT_FORMULA_BUNDLE,
  pinCareerFormulaBundle,
} from "./formulaBundle";
import { CAREER_BASE_FIELD_SIZE } from "./constants";

export const DEFAULT_FORMATION_LEASE_MS = 5 * 60 * 1000;

export interface CareerFormationClaim {
  readonly cohortId: string;
  readonly attemptId: string;
  readonly fencingToken: number;
  readonly owner: string;
  readonly leaseExpiresAt: Date;
}

export type CareerFormationClaimResult =
  | { readonly status: "claimed"; readonly claim: CareerFormationClaim }
  | {
    readonly status: "already-claimed";
    readonly owner: string | null;
    readonly fencingToken: number;
    readonly leaseExpiresAt: Date | null;
  }
  | { readonly status: "already-locked"; readonly lockedAt: Date | null }
  | { readonly status: "not-found" };

export interface CareerLockedField {
  readonly cohortId: string;
  readonly fencingToken: number;
  readonly humanCount: number;
  readonly botCount: number;
  readonly fieldSize: number;
  readonly competitionIds: readonly string[];
}

export type CareerFormationResult =
  | { readonly status: "locked"; readonly field: CareerLockedField }
  | { readonly status: "already-locked"; readonly lockedAt: Date | null };

export type BotRoundSimulator = (
  seed: string,
  course: GameCourse,
  archetype: CareerArchetype,
) => number;

interface FormationOptions {
  readonly runtimeRevision?: string;
  readonly leaseMs?: number;
  readonly simulateBotRound?: BotRoundSimulator;
  /** Test-only fault injection at the atomic publication boundary. */
  readonly beforePublishCommit?: (tx: Prisma.TransactionClient) => Promise<void>;
}

interface CalculatedSlot {
  readonly slotId: number;
  readonly competitorType: "HUMAN" | "BOT";
  readonly profileId: string | null;
  readonly botIdentityId: string | null;
  readonly abilityBand: "RUSTY" | "SCRATCH" | "ACE" | null;
  readonly tendency: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "SITUATIONAL" | null;
}

interface CalculatedResult {
  readonly slotId: number;
  readonly competitorType: "HUMAN" | "BOT";
  readonly relativeToPar: number | null;
  readonly completed: boolean;
  readonly roundId: string | null;
  readonly outputHash: string | null;
}

interface CalculatedEventLock {
  readonly competitionId: string;
  readonly eventNumber: number;
  readonly courseId: string;
  readonly seedNamespace: string;
  readonly lockHash: string;
  readonly rosterSnapshot: Prisma.JsonValue;
  readonly slots: readonly CalculatedSlot[];
  readonly results: readonly CalculatedResult[];
}

function persistedJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(canonicalStringify(value)) as Prisma.JsonValue;
}

function jsonInput(
  value: Prisma.JsonValue,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function requirePositiveLease(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
    throw new TypeError("Formation leaseMs must be a positive safe integer");
  }
}

function defaultBotRound(
  seed: string,
  course: GameCourse,
  archetype: CareerArchetype,
): number {
  return simulateArchetypeRound(
    seed,
    course,
    archetype,
    "error",
    CAREER_CURRENT_FORMULA_BUNDLE.ability.errorRates,
  );
}

export class CareerFormationService {
  private readonly runtimeRevision: string;
  private readonly leaseMs: number;
  private readonly simulateBotRound: BotRoundSimulator;
  private readonly beforePublishCommit?: FormationOptions["beforePublishCommit"];

  constructor(
    private readonly db: PrismaClient,
    options: FormationOptions = {},
  ) {
    this.runtimeRevision = options.runtimeRevision ?? "career-runtime-development";
    this.leaseMs = options.leaseMs ?? DEFAULT_FORMATION_LEASE_MS;
    this.simulateBotRound = options.simulateBotRound ?? defaultBotRound;
    this.beforePublishCommit = options.beforePublishCommit;
    requirePositiveLease(this.leaseMs);
  }

  async claim(
    cohortId: string,
    owner: string,
  ): Promise<CareerFormationClaimResult> {
    if (!cohortId.trim() || !owner.trim()) {
      throw new TypeError("Formation claim requires a cohort ID and owner");
    }
    const leaseExpiresAt = new Date(Date.now() + this.leaseMs);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`career:cohort:${cohortId}:enrollment`}, 0))
      `;
      const rows = await tx.$queryRaw<Array<{ fencingToken: number }>>(Prisma.sql`
        UPDATE "CareerCohort" AS cohort
        SET "fencingToken" = cohort."fencingToken" + 1,
            "claimToken" = cohort."fencingToken" + 1,
            "claimOwner" = ${owner},
            "leaseExpiresAt" = ${leaseExpiresAt}
        WHERE cohort."id" = ${cohortId}
          AND cohort."state" = 'FORMING'
          AND (cohort."leaseExpiresAt" IS NULL OR cohort."leaseExpiresAt" <= CURRENT_TIMESTAMP)
        RETURNING cohort."fencingToken"
      `);
      const fencingToken = rows[0]?.fencingToken;
      if (fencingToken == null) {
        const cohort = await tx.careerCohort.findUnique({ where: { id: cohortId } });
        if (!cohort) return { status: "not-found" } as const;
        if (cohort.state === "ACTIVE") {
          return { status: "already-locked", lockedAt: cohort.lockedAt } as const;
        }
        if (
          cohort.state === "FORMING"
          && cohort.leaseExpiresAt
          && cohort.leaseExpiresAt.getTime() > Date.now()
        ) {
          return {
            status: "already-claimed",
            owner: cohort.claimOwner,
            fencingToken: cohort.fencingToken,
            leaseExpiresAt: cohort.leaseExpiresAt,
          } as const;
        }
        // Player-paced Career has no "not due" state: a FORMING cohort is
        // always immediately lockable. Reaching here means someone else's lease
        // was released between the UPDATE and this read — the caller retries.
        return { status: "not-found" } as const;
      }

      await tx.careerSettlementAttempt.updateMany({
        where: {
          aggregateType: "FIELD_LOCK",
          aggregateId: cohortId,
          fencingToken: { lt: fencingToken },
          state: { in: ["CLAIMED", "SNAPSHOTTED", "CALCULATED"] },
        },
        data: {
          state: "SUPERSEDED",
          error: { reason: "superseded-by-newer-field-lock-fence" },
        },
      });
      const attempt = await tx.careerSettlementAttempt.create({
        data: {
          aggregateType: "FIELD_LOCK",
          aggregateId: cohortId,
          fencingToken,
          state: "CLAIMED",
          owner,
          trigger: "cron",
          codeRevision: this.runtimeRevision,
          leaseExpiresAt,
          formulaBundleVersion: CAREER_FORMULA_VERSION,
        },
      });
      await tx.careerCompetition.updateMany({
        where: { cohortId, state: "FORMING" },
        data: { state: "LOCKING" },
      });
      return {
        status: "claimed",
        claim: {
          cohortId,
          attemptId: attempt.id,
          fencingToken,
          owner,
          leaseExpiresAt,
        },
      } as const;
    });
  }

  private async calculate(claim: CareerFormationClaim): Promise<{
    inputSnapshot: Prisma.JsonValue;
    inputHash: string;
    eventLocks: readonly CalculatedEventLock[];
    field: CareerLockedField;
  }> {
    const cohort = await this.db.careerCohort.findUniqueOrThrow({
      where: { id: claim.cohortId },
      include: {
        world: true,
        members: {
          include: {
            profile: true,
            eventEntries: true,
          },
          orderBy: { slotId: "asc" },
        },
        competitions: {
          include: { course: true },
          orderBy: { eventNumber: "asc" },
        },
      },
    });
    if (cohort.competitions.length !== 4) {
      throw new Error(`Career cohort ${cohort.id} must have four competitions before lock`);
    }
    const humanCount = cohort.members.length;
    const fieldSize = Math.max(CAREER_BASE_FIELD_SIZE, humanCount);
    const botCount = fieldSize - humanCount;
    const storedBots = await this.db.careerBotIdentity.findMany({
      where: { worldId: cohort.worldId },
      orderBy: { botKey: "asc" },
    });
    const assignments = assignCareerBotSlots({
      worldKey: cohort.world.worldKey,
      seasonNumber: cohort.seasonNumber,
      tier: cohort.tier.toLowerCase() as "local" | "challenger" | "pro",
      eventNumber: 1,
      slots: Array.from({ length: botCount }, (_, index) => ({
        slotId: humanCount + index + 1,
        slotIndex: index,
      })),
      roster: storedBots.map((bot) => ({
        botKey: bot.botKey,
        displayName: bot.displayName,
        homeFlavor: bot.homeFlavor,
        tendency: bot.tendency.toLowerCase() as CareerArchetype["tendency"],
        recurring: bot.recurring,
      })),
    });
    const botIdByKey = new Map(storedBots.map((bot) => [bot.botKey, bot.id]));
    const baseSlots: CalculatedSlot[] = [
      ...cohort.members.map((member) => ({
        slotId: member.slotId,
        competitorType: "HUMAN" as const,
        profileId: member.profileId,
        botIdentityId: null,
        abilityBand: null,
        tendency: null,
      })),
      ...assignments.map((assignment) => ({
        slotId: assignment.slotId,
        competitorType: "BOT" as const,
        profileId: null,
        botIdentityId: botIdByKey.get(assignment.identity.botKey) ?? null,
        abilityBand: assignment.abilityBand.toUpperCase() as "RUSTY" | "SCRATCH" | "ACE",
        tendency: assignment.tendency.toUpperCase() as CalculatedSlot["tendency"],
      })),
    ].sort((left, right) => left.slotId - right.slotId);
    if (baseSlots.some((slot) => slot.competitorType === "BOT" && !slot.botIdentityId)) {
      throw new Error(`Career cohort ${cohort.id} is missing a persisted bot identity`);
    }

    const input = {
      cohort: {
        id: cohort.id,
        worldId: cohort.worldId,
        worldKey: cohort.world.worldKey,
        seasonNumber: cohort.seasonNumber,
        tier: cohort.tier,
      },
      humans: cohort.members.map((member) => ({
        slotId: member.slotId,
        profileId: member.profileId,
        entries: [...member.eventEntries]
          .sort((left, right) => left.competitionId.localeCompare(right.competitionId))
          .map((entry) => ({
            competitionId: entry.competitionId,
            roundId: entry.roundId,
            completed: entry.completed,
            relativeToPar: entry.relativeToPar,
            submittedAt: entry.submittedAt,
          })),
      })),
      competitions: cohort.competitions.map((event) => ({
        id: event.id,
        eventNumber: event.eventNumber,
        courseId: event.courseId,
        courseSlug: event.course.slug,
        unlocksAt: event.unlocksAt,
        deadlineAt: event.deadlineAt,
        roundsPerPlayer: event.roundsPerPlayer,
      })),
    };
    const pin = pinCareerFormulaBundle(CAREER_FORMULA_VERSION, this.runtimeRevision);
    const inputSnapshot = persistedJson({
      canonicalVersion: CAREER_CANONICAL_VERSION,
      aggregate: { type: "FIELD_LOCK", id: cohort.id },
      formula: pin,
      input,
    });
    const lockInputHash = canonicalHash(inputSnapshot);

    const gameCourseBySlug = new Map(COURSES.map((course) => [course.slug, course]));
    const eventLocks: CalculatedEventLock[] = cohort.competitions.map((event) => {
      if (event.eventNumber == null) throw new Error(`Competition ${event.id} has no event number`);
      const gameCourse = gameCourseBySlug.get(event.course.slug);
      if (!gameCourse) {
        throw new Error(`Career course ${event.course.slug} is not available in the game catalogue`);
      }
      const seedNamespace =
        `career:${cohort.world.worldKey}:${cohort.seasonNumber}:${cohort.tier.toLowerCase()}:event${event.eventNumber}`;
      const results: CalculatedResult[] = baseSlots.map((slot) => {
        if (slot.competitorType === "HUMAN") {
          const member = cohort.members.find((candidate) => candidate.profileId === slot.profileId)!;
          const entry = member.eventEntries.find((candidate) => candidate.competitionId === event.id);
          const completed = Boolean(entry?.completed && entry.relativeToPar != null);
          return {
            slotId: slot.slotId,
            competitorType: "HUMAN",
            relativeToPar: completed ? entry!.relativeToPar : null,
            completed,
                  roundId: entry?.roundId ?? null,
            outputHash: completed
              ? canonicalHash({
                competitionId: event.id,
                slotId: slot.slotId,
                roundId: entry!.roundId,
                relativeToPar: entry!.relativeToPar,
              })
              : null,
          };
        }
        const assignment = assignments.find((candidate) => candidate.slotId === slot.slotId)!;
        const relativeToPar = Array.from(
          { length: event.roundsPerPlayer },
          (_, roundIndex) => this.simulateBotRound(
            `${seedNamespace}:round${roundIndex + 1}:slot${slot.slotId}`,
            gameCourse,
            {
              ability: assignment.abilityBand,
              tendency: assignment.tendency,
            },
          ),
        ).reduce((sum, score) => sum + score, 0);
        return {
          slotId: slot.slotId,
          competitorType: "BOT",
          relativeToPar,
          completed: true,
              roundId: null,
          outputHash: canonicalHash({
            seedNamespace,
            slotId: slot.slotId,
            roundsPerPlayer: event.roundsPerPlayer,
            relativeToPar,
            formulaVersion: CAREER_FORMULA_VERSION,
          }),
        };
      });
      const rosterSnapshot = persistedJson({
        cohortId: cohort.id,
        competitionId: event.id,
        eventNumber: event.eventNumber,
        courseId: event.courseId,
        fieldSize,
        seedNamespace,
        roundsPerPlayer: event.roundsPerPlayer,
        slots: baseSlots,
      });
      return {
        competitionId: event.id,
        eventNumber: event.eventNumber,
        courseId: event.courseId,
        seedNamespace,
        lockHash: canonicalHash(rosterSnapshot),
        rosterSnapshot,
        slots: baseSlots,
        results,
      };
    });
    return {
      inputSnapshot,
      inputHash: lockInputHash,
      eventLocks,
      field: {
        cohortId: cohort.id,
        fencingToken: claim.fencingToken,
        humanCount,
        botCount,
        fieldSize,
        competitionIds: eventLocks.map((event) => event.competitionId),
      },
    };
  }

  private async publish(
    claim: CareerFormationClaim,
    calculation: Awaited<ReturnType<CareerFormationService["calculate"]>>,
  ): Promise<CareerLockedField> {
    const effects = calculation.eventLocks.flatMap((event) => [
      {
        effectKey: careerEffectKey.fieldLock(event.competitionId, 1),
        effectType: "field-lock",
        scope: event.competitionId,
        payload: {
          competitionId: event.competitionId,
          revision: 1,
          lockHash: event.lockHash,
          fieldSize: calculation.field.fieldSize,
        },
      },
      ...event.results
        .filter((result) => result.competitorType === "BOT")
        .map((result) => ({
          effectKey: careerEffectKey.botResult(
            event.competitionId,
            1,
            result.slotId,
            CAREER_FORMULA_VERSION,
          ),
          effectType: "bot-result",
          scope: event.competitionId,
          payload: {
            competitionId: event.competitionId,
            revision: 1,
            slotId: result.slotId,
            relativeToPar: result.relativeToPar,
            outputHash: result.outputHash,
          },
        })),
    ]);
    const outboxEffect = {
      effectKey: careerEffectKey.outbox(
        calculation.inputHash,
        "field-locked",
        claim.cohortId,
      ),
      effectType: "field-locked",
      scope: claim.cohortId,
      payload: calculation.field,
      isOutbox: true,
    };
    const allEffects = [...effects, outboxEffect]
      .map((effect) => {
        const payload = persistedJson(effect.payload);
        const isOutbox = "isOutbox" in effect && effect.isOutbox === true;
        return {
          ...effect,
          isOutbox,
          payload,
          payloadHash: payloadHash({
            effectType: effect.effectType,
            scope: effect.scope,
            isOutbox,
            payload,
          }),
        };
      })
      .sort((left, right) => left.effectKey.localeCompare(right.effectKey));
    const outputResult = persistedJson({
      field: calculation.field,
      eventLocks: calculation.eventLocks.map((event) => ({
        competitionId: event.competitionId,
        eventNumber: event.eventNumber,
        lockHash: event.lockHash,
        botResults: event.results
          .filter((result) => result.competitorType === "BOT")
          .map((result) => ({
            slotId: result.slotId,
            relativeToPar: result.relativeToPar,
            outputHash: result.outputHash,
          })),
      })),
    });
    const outputSnapshot = persistedJson({
      canonicalVersion: CAREER_CANONICAL_VERSION,
      result: outputResult,
      expectedEffectCount: allEffects.length,
      effectManifest: allEffects.map((effect) => ({
        effectKey: effect.effectKey,
        effectType: effect.effectType,
        scope: effect.scope,
        isOutbox: effect.isOutbox,
        payloadHash: effect.payloadHash,
      })),
    });
    const outputHash = canonicalHash(outputSnapshot);

    return this.db.$transaction(async (tx) => {
      const current = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT cohort."id"
        FROM "CareerCohort" cohort
        WHERE cohort."id" = ${claim.cohortId}
          AND cohort."state" = 'FORMING'
          AND cohort."fencingToken" = ${claim.fencingToken}
          AND cohort."claimToken" = ${claim.fencingToken}
          AND cohort."claimOwner" = ${claim.owner}
          AND cohort."leaseExpiresAt" > CURRENT_TIMESTAMP
        FOR UPDATE
      `);
      if (current.length !== 1) throw new Error("Career formation claim is stale or expired");
      const attempt = await tx.careerSettlementAttempt.findUniqueOrThrow({
        where: { id: claim.attemptId },
      });
      if (
        attempt.aggregateType !== "FIELD_LOCK"
        || attempt.aggregateId !== claim.cohortId
        || attempt.fencingToken !== claim.fencingToken
        || attempt.owner !== claim.owner
        || attempt.state !== "CLAIMED"
      ) {
        throw new Error("Career formation attempt is no longer current");
      }

      for (const event of calculation.eventLocks) {
        const revision = await tx.careerLockRevision.create({
          data: {
            competitionId: event.competitionId,
            revision: 1,
            lockHash: event.lockHash,
            formulaBundle: jsonInput(persistedJson(
              pinCareerFormulaBundle(CAREER_FORMULA_VERSION, this.runtimeRevision),
            )),
            rosterSnapshot: jsonInput(event.rosterSnapshot),
          },
        });
        await tx.careerFieldSlot.createMany({
          data: event.slots.map((slot) => ({
            competitionId: event.competitionId,
            lockRevisionId: revision.id,
            slotId: slot.slotId,
            competitorType: slot.competitorType,
            profileId: slot.profileId,
            botIdentityId: slot.botIdentityId,
            abilityBand: slot.abilityBand,
            tendency: slot.tendency,
            seedNamespace: `${event.seedNamespace}:slot${slot.slotId}`,
          })),
        });
        await tx.careerResult.createMany({
          data: event.results.map((result) => ({
            competitionId: event.competitionId,
            lockRevisionId: revision.id,
            slotId: result.slotId,
            competitorType: result.competitorType,
            relativeToPar: result.relativeToPar,
            completed: result.completed,
            roundId: result.roundId,
            outputHash: result.outputHash,
          })),
        });
      }

      await tx.careerStagedEffect.createMany({
        data: allEffects.map((effect) => ({
          attemptId: claim.attemptId,
          effectKey: effect.effectKey,
          effectType: effect.effectType,
          scope: effect.scope,
          isOutbox: effect.isOutbox,
          payload: jsonInput(effect.payload),
          payloadHash: effect.payloadHash,
        })),
      });
      await tx.careerCommittedEffect.createMany({
        data: allEffects.map((effect) => ({
          aggregateType: "FIELD_LOCK",
          aggregateId: claim.cohortId,
          committedRevisionId: calculation.inputHash,
          effectKey: effect.effectKey,
          effectType: effect.effectType,
          scope: effect.scope,
          isOutbox: effect.isOutbox,
          payload: jsonInput(effect.payload),
          payloadHash: effect.payloadHash,
        })),
      });
      await tx.careerOutbox.create({
        data: {
          committedRevisionId: calculation.inputHash,
          effectType: outboxEffect.effectType,
          scope: outboxEffect.scope,
          payload: jsonInput(persistedJson(outboxEffect.payload)),
        },
      });
      await tx.careerSettlementAttempt.update({
        where: { id: claim.attemptId },
        data: {
          state: "COMMITTED",
          formulaBundleVersion: CAREER_FORMULA_VERSION,
          inputHash: calculation.inputHash,
          outputHash,
          inputSnapshot: jsonInput(calculation.inputSnapshot),
          outputSnapshot: jsonInput(outputSnapshot),
          expectedEffectCount: allEffects.length,
        },
      });
      await this.beforePublishCommit?.(tx);
      // Player-paced: every event is playable the moment the field locks.
      // There are no unlock days, so there is no LOCKED-but-waiting state.
      await tx.$executeRaw`
        UPDATE "CareerCompetition"
        SET "state" = 'ACTIVE'::"CareerCompetitionState",
        "targetFieldSize" = ${calculation.field.fieldSize},
        "claimOwner" = NULL,
        "claimToken" = NULL,
        "leaseExpiresAt" = NULL
        WHERE "cohortId" = ${claim.cohortId}
          AND "state" = 'LOCKING'
      `;
      await tx.careerCohort.update({
        where: { id: claim.cohortId },
        data: {
          state: "ACTIVE",
          lockedAt: new Date(),
          claimOwner: null,
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
      return calculation.field;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    });
  }

  private async releaseRetryable(
    claim: CareerFormationClaim,
    error: unknown,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const cohort = await tx.careerCohort.updateMany({
        where: {
          id: claim.cohortId,
          state: "FORMING",
          fencingToken: claim.fencingToken,
          claimToken: claim.fencingToken,
          claimOwner: claim.owner,
        },
        data: {
          claimOwner: null,
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
      if (cohort.count !== 1) return;
      await tx.careerCompetition.updateMany({
        where: { cohortId: claim.cohortId, state: "LOCKING" },
        data: { state: "FORMING" },
      });
      await tx.careerSettlementAttempt.updateMany({
        where: {
          id: claim.attemptId,
          state: "CLAIMED",
          fencingToken: claim.fencingToken,
          owner: claim.owner,
        },
        data: {
          state: "FAILED_RETRYABLE",
          error: {
            reason: "field-lock-calculation-failed",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
    });
  }

  async lock(
    cohortId: string,
    owner: string,
  ): Promise<CareerFormationResult | CareerFormationClaimResult> {
    const claimed = await this.claim(cohortId, owner);
    if (claimed.status !== "claimed") return claimed;
    try {
      const calculation = await this.calculate(claimed.claim);
      const field = await this.publish(claimed.claim, calculation);
      return { status: "locked", field };
    } catch (error) {
      await this.releaseRetryable(claimed.claim, error);
      throw error;
    }
  }
}
