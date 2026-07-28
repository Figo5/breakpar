import { Prisma, type PrismaClient } from "@prisma/client";

import { canonicalHash, canonicalStringify } from "./canonical";
import { careerEffectKey } from "./effectKeys";
import { requireCareerFormulaBundle } from "./formulaBundle";
import { rankEvent } from "./rules";
import {
  CareerSettlementEngine,
  type ClaimSettlementResult,
  type SettlementClaim,
  type SettlementEffect,
} from "./settlementEngine";

export interface CareerEventStanding {
  readonly slotId: number;
  readonly competitorId: string;
  readonly competitorType: "HUMAN" | "BOT";
  readonly profileId: string | null;
  readonly botIdentityId: string | null;
  readonly completed: boolean;
  readonly noShow: boolean;
  readonly relativeToPar: number | null;
  readonly rank: number | null;
  readonly points: number;
}

export interface CareerEventSettlementOutput {
  readonly competitionId: string;
  readonly lockRevisionId: string;
  readonly lockRevision: number;
  readonly formulaVersion: string;
  readonly fieldSize: number;
  readonly standings: readonly CareerEventStanding[];
}

export type SettleCareerEventResult =
  | {
    readonly status: "settled";
    readonly competitionId: string;
    readonly committedAttemptId: string;
  }
  | Exclude<ClaimSettlementResult, { status: "claimed" }>;

interface EventSettlementOptions {
  readonly runtimeRevision?: string;
}

function persistedJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(canonicalStringify(value)) as Prisma.JsonValue;
}

function jsonInput(
  value: Prisma.JsonValue,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

export function calculateCareerEventStandings(
  entries: readonly {
    slotId: number;
    competitorType: "HUMAN" | "BOT";
    profileId: string | null;
    botIdentityId: string | null;
    relativeToPar: number | null;
    completed: boolean;
  }[],
): readonly CareerEventStanding[] {
  const ordered = [...entries].sort((left, right) => left.slotId - right.slotId);
  if (new Set(ordered.map((entry) => entry.slotId)).size !== ordered.length) {
    throw new Error("Career event settlement received duplicate slot IDs");
  }
  const identities = ordered.map((entry) => {
    const competitorId = entry.competitorType === "HUMAN"
      ? entry.profileId
      : entry.botIdentityId;
    if (!competitorId) {
      throw new Error(`Career ${entry.competitorType.toLowerCase()} slot ${entry.slotId} has no identity`);
    }
    return {
      ...entry,
      competitorId: `${entry.competitorType.toLowerCase()}:${competitorId}`,
      score: entry.completed && entry.relativeToPar != null ? entry.relativeToPar : null,
    };
  });
  if (new Set(identities.map((entry) => entry.competitorId)).size !== identities.length) {
    throw new Error("Career event settlement received duplicate competitors");
  }
  const ranked = new Map(
    rankEvent(identities.map((entry) => ({
      competitorId: entry.competitorId,
      relativeToPar: entry.score,
    }))).map((standing) => [standing.competitorId, standing]),
  );
  return identities.map((entry) => {
    const standing = ranked.get(entry.competitorId)!;
    return {
      slotId: entry.slotId,
      competitorId: entry.competitorId,
      competitorType: entry.competitorType,
      profileId: entry.profileId,
      botIdentityId: entry.botIdentityId,
      completed: standing.completed,
      noShow: !standing.completed,
      relativeToPar: standing.relativeToPar,
      rank: standing.rank,
      points: standing.points,
    };
  });
}

export class CareerEventSettlementService {
  private readonly engine: CareerSettlementEngine;
  private readonly runtimeRevision: string;

  constructor(
    private readonly db: PrismaClient,
    options: EventSettlementOptions = {},
  ) {
    this.engine = new CareerSettlementEngine(db);
    this.runtimeRevision = options.runtimeRevision ?? "career-runtime-development";
  }

  /**
   * Close every event whose human has finished playing.
   *
   * Player-paced Career has no deadlines. The bots' cards are materialized when
   * the season's field locks, so an event's field is complete the instant the
   * human's entry completes — that is the only close condition.
   */
  async closeDue(_now = new Date()): Promise<number> {
    const due = await this.db.careerCompetition.updateMany({
      where: {
        kind: "EVENT",
        state: "ACTIVE",
        // `every` is vacuously true on an empty relation, so require the
        // human entry to exist as well as be complete.
        eventEntries: { some: {}, every: { completed: true } },
      },
      data: {
        state: "ENDED",
        claimOwner: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    });
    return due.count;
  }

  /** Close one specific event if its human has finished. Idempotent. */
  async closeIfComplete(competitionId: string): Promise<boolean> {
    const closed = await this.db.careerCompetition.updateMany({
      where: {
        id: competitionId,
        kind: "EVENT",
        state: "ACTIVE",
        // `every` is vacuously true on an empty relation, so require the
        // human entry to exist as well as be complete.
        eventEntries: { some: {}, every: { completed: true } },
      },
      data: {
        state: "ENDED",
        claimOwner: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    });
    return closed.count === 1;
  }

  private async snapshotAndCalculate(
    claim: SettlementClaim,
  ): Promise<{
    output: CareerEventSettlementOutput;
    effects: readonly SettlementEffect[];
  }> {
    const competition = await this.db.careerCompetition.findUniqueOrThrow({
      where: { id: claim.aggregate.id },
      include: {
        lockRevisions: {
          include: {
            slots: { orderBy: { slotId: "asc" } },
            results: { orderBy: { slotId: "asc" } },
          },
          orderBy: { revision: "desc" },
        },
      },
    });
    if (competition.kind !== "EVENT" || competition.state !== "ENDED") {
      throw new Error(`Career event ${competition.id} is not eligible for settlement`);
    }
    if (competition.lockRevisions.length !== 1) {
      throw new Error(
        `Career event ${competition.id} requires exactly one immutable lock revision`,
      );
    }
    const lock = competition.lockRevisions[0];
    const formulaVersion = (
      lock.formulaBundle as { formulaPackageVersion?: unknown } | null
    )?.formulaPackageVersion;
    if (typeof formulaVersion !== "string") {
      throw new Error(`Career event ${competition.id} lock has no formula package`);
    }
    requireCareerFormulaBundle(formulaVersion);
    if (
      lock.slots.length !== competition.targetFieldSize
      || lock.results.length !== competition.targetFieldSize
    ) {
      throw new Error(`Career event ${competition.id} locked field/result count mismatch`);
    }
    const resultBySlot = new Map(lock.results.map((result) => [result.slotId, result]));
    const inputResults = lock.slots.map((slot) => {
      const result = resultBySlot.get(slot.slotId);
      if (!result || result.competitorType !== slot.competitorType) {
        throw new Error(`Career event ${competition.id} has a corrupt result for slot ${slot.slotId}`);
      }
      return {
        slotId: slot.slotId,
        competitorType: slot.competitorType,
        profileId: slot.profileId,
        botIdentityId: slot.botIdentityId,
        relativeToPar: result.relativeToPar,
        completed: result.completed,
        roundId: result.roundId,
        outputHash: result.outputHash,
      };
    });
    await this.engine.snapshot(claim, {
      input: {
        competition: {
          id: competition.id,
          cohortId: competition.cohortId,
          eventNumber: competition.eventNumber,
          courseId: competition.courseId,
          targetFieldSize: competition.targetFieldSize,
          deadlineAt: competition.deadlineAt,
        },
        lock: {
          id: lock.id,
          revision: lock.revision,
          lockHash: lock.lockHash,
          rosterSnapshot: lock.rosterSnapshot,
        },
        results: inputResults,
      },
      formulaVersion,
      runtimeRevision: this.runtimeRevision,
    });

    const standings = calculateCareerEventStandings(inputResults);
    const output: CareerEventSettlementOutput = {
      competitionId: competition.id,
      lockRevisionId: lock.id,
      lockRevision: lock.revision,
      formulaVersion,
      fieldSize: standings.length,
      standings,
    };
    const finalIdentity =
      `${competition.id}:lock${lock.revision}:${formulaVersion}`;
    const effects: SettlementEffect[] = [
      {
        effectKey: careerEffectKey.eventFinal(
          competition.id,
          lock.revision,
          formulaVersion,
        ),
        effectType: "event-final",
        scope: competition.id,
        payload: output,
      },
      ...standings.map((standing) => ({
        effectKey: careerEffectKey.eventStanding(
          finalIdentity,
          standing.competitorId,
        ),
        effectType: "event-standing",
        scope: standing.competitorId,
        payload: {
          competitionId: competition.id,
          lockRevision: lock.revision,
          ...standing,
        },
      })),
    ];
    await this.engine.calculateAndStage(claim, output, effects);
    return { output, effects };
  }

  async settle(
    competitionId: string,
    owner: string,
    trigger: "cron" | "read-repair" | "manual" = "cron",
  ): Promise<SettleCareerEventResult> {
    const claimed = await this.engine.claim({
      aggregate: { type: "EVENT", id: competitionId },
      owner,
      trigger,
      codeRevision: this.runtimeRevision,
    });
    if (claimed.status !== "claimed") return claimed;
    try {
      const { output } = await this.snapshotAndCalculate(claimed.claim);
      const result = await this.engine.publish(claimed.claim, {
        apply: async (tx, context) => {
          const storedOutput = context.output as unknown as CareerEventSettlementOutput;
          if (
            storedOutput.competitionId !== output.competitionId
            || storedOutput.lockRevisionId !== output.lockRevisionId
          ) {
            throw new Error("Career event output does not match the claimed event");
          }
          // No no-show conversion: an event only reaches settlement once every
          // competitor has completed (bots at field lock, the human on finish),
          // so an incomplete result here is a corrupt field, not an absence.
          const incomplete = await tx.careerResult.count({
            where: {
              competitionId,
              lockRevisionId: output.lockRevisionId,
              completed: false,
            },
          });
          if (incomplete > 0) {
            throw new Error(
              `Career event ${competitionId} has ${incomplete} incomplete result(s) at settlement`,
            );
          }
          await tx.careerEventFinal.create({
            data: {
              competitionId,
              lockRevisionId: output.lockRevisionId,
              formulaVersion: output.formulaVersion,
              standings: jsonInput(persistedJson(output.standings)),
              outputHash: canonicalHash(output.standings),
            },
          });
        },
      });
      return {
        status: "settled",
        competitionId,
        committedAttemptId: result.committedAttemptId ?? claimed.claim.attemptId,
      };
    } catch (error) {
      try {
        await this.engine.markRetryable(claimed.claim, "event-settlement-failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // A publication conflict may already have moved the aggregate to manual
        // review, or a concurrent fence may own recovery.
      }
      throw error;
    }
  }
}
