/**
 * Career Mode — Championship result settlement and immutable final ranking.
 *
 * The Championship analogue of `eventSettlement.ts`: a pure ranking core plus a
 * publication service that wires through `CareerSettlementEngine` (CHAMPIONSHIP
 * aggregate; claim → snapshot → calculateAndStage → publish → markRetryable).
 *
 * Ranking reuses the frozen `rankEvent` (ascending relative-to-par, ties share
 * occupied-position points). Incomplete/never-started humans are no-shows. The
 * single Champion is the best completed competitor, ties broken by a
 * deterministic playoff draw (the frozen "deterministic standings fallback").
 *
 * This iteration ranks and settles results ONLY. It does NOT award Championship
 * Legacy points or trophies, and by design emits NO regular tier-movement,
 * inactivity, season-rating, or next-season-enrollment effects. Those are the
 * following iteration.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { hashSeed } from "@/lib/engine/rng";

import { canonicalHash, canonicalStringify } from "./canonical";
import { careerEffectKey } from "./effectKeys";
import {
  CAREER_FORMULA_VERSION,
  requireCareerFormulaBundle,
} from "./formulaBundle";
import { materializeChampionshipBots } from "./championshipPlay";
import { rankEvent, type LegacyPointSchedule } from "./rules";
import {
  CareerSettlementEngine,
  type ClaimSettlementResult,
  type SettlementClaim,
  type SettlementEffect,
} from "./settlementEngine";

// ---------------------------------------------------------------------------
// Pure ranking core
// ---------------------------------------------------------------------------

export interface ChampionshipSettlementCompetitor {
  readonly competitorId: string; // "human:{profileId}" | "bot:{botIdentityId}"
  readonly slotNumber: number;
  readonly competitorType: "HUMAN" | "BOT";
  readonly profileId: string | null;
  readonly botIdentityId: string | null;
  /** Null ⇒ no-show / did not finish. */
  readonly relativeToPar: number | null;
  /** Deterministic playoff draw for tie-breaking the single Champion. */
  readonly fallbackDraw: number;
}

export interface ChampionshipStanding {
  readonly slotNumber: number;
  readonly competitorId: string;
  readonly competitorType: "HUMAN" | "BOT";
  readonly profileId: string | null;
  readonly botIdentityId: string | null;
  readonly completed: boolean;
  readonly noShow: boolean;
  readonly relativeToPar: number | null;
  readonly rank: number | null;
  readonly points: number;
  readonly isWinner: boolean;
}

export interface ChampionshipSettlementOutput {
  readonly championshipId: string;
  readonly formulaVersion: string;
  readonly fieldSize: number;
  readonly winnerCompetitorId: string | null;
  readonly standings: readonly ChampionshipStanding[];
}

/**
 * Rank the exactly-20 Championship field. Deterministic and pure.
 */
export function rankChampionshipField(
  championshipId: string,
  competitors: readonly ChampionshipSettlementCompetitor[],
  formulaVersion = CAREER_FORMULA_VERSION,
): ChampionshipSettlementOutput {
  const bySlot = [...competitors].sort((left, right) => left.slotNumber - right.slotNumber);
  if (new Set(bySlot.map((entry) => entry.slotNumber)).size !== bySlot.length) {
    throw new Error("Championship settlement received duplicate slot numbers");
  }
  if (new Set(bySlot.map((entry) => entry.competitorId)).size !== bySlot.length) {
    throw new Error("Championship settlement received duplicate competitors");
  }

  const ranked = new Map(
    rankEvent(bySlot.map((entry) => ({
      competitorId: entry.competitorId,
      relativeToPar: entry.relativeToPar,
    }))).map((standing) => [standing.competitorId, standing]),
  );

  // The single Champion: the best completed competitor, ties (rank 1) broken by
  // the deterministic playoff draw, then competitor id for total determinism.
  const leaders = bySlot
    .filter((entry) => ranked.get(entry.competitorId)!.rank === 1)
    .sort((left, right) =>
      left.fallbackDraw - right.fallbackDraw
      || left.competitorId.localeCompare(right.competitorId));
  const winnerCompetitorId = leaders[0]?.competitorId ?? null;

  const standings: ChampionshipStanding[] = bySlot.map((entry) => {
    const standing = ranked.get(entry.competitorId)!;
    return {
      slotNumber: entry.slotNumber,
      competitorId: entry.competitorId,
      competitorType: entry.competitorType,
      profileId: entry.profileId,
      botIdentityId: entry.botIdentityId,
      completed: standing.completed,
      noShow: !standing.completed,
      relativeToPar: standing.relativeToPar,
      rank: standing.rank,
      points: standing.points,
      isWinner: entry.competitorId === winnerCompetitorId,
    };
  });

  return {
    championshipId,
    formulaVersion,
    fieldSize: standings.length,
    winnerCompetitorId,
    standings,
  };
}

// ---------------------------------------------------------------------------
// Frozen Championship Legacy awards
// ---------------------------------------------------------------------------

export const CAREER_CHAMPIONSHIP_SOURCE_TYPE = "championship";
export const CAREER_CHAMPIONSHIP_TROPHY = "championship";

export type ChampionshipLegacyAwardType = "championshipWin";

export interface ChampionshipLegacyAward {
  readonly profileId: string;
  readonly awardType: ChampionshipLegacyAwardType;
  readonly points: number;
}

export interface ChampionshipLegacyDerivation {
  readonly awards: readonly ChampionshipLegacyAward[];
  /** The human winner who also earns the Championship trophy, if any. */
  readonly trophyProfileId: string | null;
}

/**
 * Derive the frozen Championship Legacy awards from the final standings.
 * Qualification Legacy publishes once when the Championship unlocks during
 * season settlement, so Championship settlement emits only the win award and
 * trophy when the settled winner is human. Bots hold persistent identities but
 * accrue no human Legacy or trophy.
 */
export function deriveChampionshipLegacy(
  standings: readonly ChampionshipStanding[],
  schedule: LegacyPointSchedule,
): ChampionshipLegacyDerivation {
  const win = Math.max(0, schedule.championshipWin);
  const awards: ChampionshipLegacyAward[] = [];
  let trophyProfileId: string | null = null;
  for (const standing of standings) {
    if (standing.competitorType !== "HUMAN" || !standing.profileId) continue;
    if (standing.isWinner) {
      awards.push({
        profileId: standing.profileId,
        awardType: "championshipWin",
        points: win,
      });
      trophyProfileId = standing.profileId;
    }
  }
  return { awards, trophyProfileId };
}

// ---------------------------------------------------------------------------
// Publication service
// ---------------------------------------------------------------------------

export type SettleCareerChampionshipResult =
  | {
    readonly status: "settled";
    readonly championshipId: string;
    readonly committedAttemptId: string;
    readonly winnerCompetitorId: string | null;
  }
  | Exclude<ClaimSettlementResult, { status: "claimed" }>;

interface ChampionshipSettlementOptions {
  readonly runtimeRevision?: string;
}

function persistedJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(canonicalStringify(value)) as Prisma.JsonValue;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return persistedJson(value) as Prisma.InputJsonValue;
}

export class CareerChampionshipSettlementService {
  private readonly engine: CareerSettlementEngine;
  private readonly runtimeRevision: string;

  constructor(
    private readonly db: PrismaClient,
    options: ChampionshipSettlementOptions = {},
  ) {
    this.engine = new CareerSettlementEngine(db);
    this.runtimeRevision = options.runtimeRevision ?? "career-runtime-development";
  }

  /**
   * Close every ACTIVE Championship whose player has finished their round.
   *
   * Player-paced Championships never expire: an unplayed one simply stays ACTIVE
   * forever and never settles, which is exactly what "missing it costs nothing"
   * means. So the close condition is the human's completion, not a deadline —
   * and there is no no-show conversion, because absence is unreachable.
   */
  async closeDue(now = new Date()): Promise<number> {
    const due = await this.db.careerChampionship.findMany({
      where: {
        state: "ACTIVE",
        results: { some: { competitorType: "HUMAN", completed: true } },
      },
      select: { id: true },
    });
    let closed = 0;
    for (const championship of due) {
      // Idempotent; guarantees every bot slot has a materialized result.
      await materializeChampionshipBots(this.db, championship.id, { now });
      const didClose = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${`career:championship-close:${championship.id}`}, 0))
        `;
        const record = await tx.careerChampionship.findUnique({
          where: { id: championship.id },
          include: {
            competitions: { where: { kind: "CHAMPIONSHIP" } },
            slots: true,
            results: { select: { slotNumber: true, completed: true, competitorType: true } },
          },
        });
        if (!record || record.state !== "ACTIVE") return false;
        const competition = record.competitions[0];
        if (!competition) return false;

        // The player must have finished; bots are materialized above.
        const human = record.results.find((result) => result.competitorType === "HUMAN");
        if (!human?.completed) return false;
        if (record.results.some((result) => !result.completed)) return false;

        const resultCount = await tx.careerChampionshipResult.count({
          where: { championshipId: record.id },
        });
        if (resultCount !== competition.targetFieldSize) {
          throw new Error(
            `Championship ${record.id} has ${resultCount} results; expected ${competition.targetFieldSize}`,
          );
        }

        await tx.careerCompetition.updateMany({
          where: { id: competition.id, kind: "CHAMPIONSHIP" },
          data: { state: "ENDED", claimOwner: null, claimToken: null, leaseExpiresAt: null },
        });
        const ended = await tx.careerChampionship.updateMany({
          where: { id: record.id, state: "ACTIVE" },
          data: { state: "ENDED", claimOwner: null, claimToken: null, leaseExpiresAt: null },
        });
        return ended.count === 1;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
      });
      if (didClose) closed += 1;
    }
    return closed;
  }

  private async snapshotAndCalculate(claim: SettlementClaim): Promise<{
    output: ChampionshipSettlementOutput;
    effects: readonly SettlementEffect[];
  }> {
    const championship = await this.db.careerChampionship.findUniqueOrThrow({
      where: { id: claim.aggregate.id },
      include: {
        world: true,
        competitions: { where: { kind: "CHAMPIONSHIP" } },
        results: { orderBy: { slotNumber: "asc" } },
      },
    });
    if (championship.state !== "ENDED") {
      throw new Error(`Career championship ${championship.id} is not eligible for settlement`);
    }
    const competition = championship.competitions[0];
    if (!competition) {
      throw new Error(`Career championship ${championship.id} has no published competition`);
    }
    if (championship.results.length !== competition.targetFieldSize) {
      throw new Error(
        `Career championship ${championship.id} has ${championship.results.length} results; expected ${competition.targetFieldSize}`,
      );
    }

    const playoffNamespace =
      `career:championship:${championship.world.worldKey}:c${championship.cycleNumber}:playoff`;
    const competitors: ChampionshipSettlementCompetitor[] = championship.results.map((result) => {
      const competitorId = result.competitorType === "HUMAN"
        ? `human:${result.profileId}`
        : `bot:${result.botIdentityId}`;
      const identity = result.competitorType === "HUMAN" ? result.profileId : result.botIdentityId;
      if (!identity) {
        throw new Error(`Championship result slot ${result.slotNumber} has no competitor identity`);
      }
      return {
        competitorId,
        slotNumber: result.slotNumber,
        competitorType: result.competitorType,
        profileId: result.profileId,
        botIdentityId: result.botIdentityId,
        relativeToPar: result.completed ? result.relativeToPar : null,
        // A raw integer draw (not a float) so it survives PostgreSQL JSONB
        // normalization in the immutable input snapshot — mirroring the season
        // settlement's stable fallback draw.
        fallbackDraw: hashSeed(`${playoffNamespace}:${competitorId}`),
      };
    });

    const formulaBundle = requireCareerFormulaBundle(championship.formulaVersion);
    const output = rankChampionshipField(
      championship.id,
      competitors,
      championship.formulaVersion,
    );

    await this.engine.snapshot(claim, {
      input: {
        championshipId: championship.id,
        cycleNumber: championship.cycleNumber,
        competitionId: competition.id,
        competitors,
      },
      formulaVersion: championship.formulaVersion,
      runtimeRevision: this.runtimeRevision,
    });

    const effects: SettlementEffect[] = [
      {
        effectKey: careerEffectKey.championshipFinal(
          championship.id,
          championship.formulaVersion,
        ),
        effectType: "championship-final",
        scope: championship.id,
        payload: output,
      },
    ];
    const legacy = deriveChampionshipLegacy(
      output.standings,
      formulaBundle.legacyPoints,
    );
    for (const award of legacy.awards) {
      effects.push({
        effectKey: careerEffectKey.legacy(
          award.profileId,
          CAREER_CHAMPIONSHIP_SOURCE_TYPE,
          championship.id,
          award.awardType,
        ),
        effectType: "legacy",
        scope: award.profileId,
        payload: {
          profileId: award.profileId,
          sourceType: CAREER_CHAMPIONSHIP_SOURCE_TYPE,
          sourceId: championship.id,
          awardType: award.awardType,
          points: award.points,
        },
      });
    }
    if (legacy.trophyProfileId) {
      effects.push({
        effectKey: careerEffectKey.trophy(
          legacy.trophyProfileId,
          CAREER_CHAMPIONSHIP_SOURCE_TYPE,
          championship.id,
          CAREER_CHAMPIONSHIP_TROPHY,
        ),
        effectType: "trophy",
        scope: legacy.trophyProfileId,
        payload: {
          profileId: legacy.trophyProfileId,
          sourceType: CAREER_CHAMPIONSHIP_SOURCE_TYPE,
          sourceId: championship.id,
          trophyType: CAREER_CHAMPIONSHIP_TROPHY,
        },
      });
    }
    await this.engine.calculateAndStage(claim, output, effects);
    return { output, effects };
  }

  async settle(
    championshipId: string,
    owner: string,
    trigger: "cron" | "read-repair" | "manual" = "cron",
  ): Promise<SettleCareerChampionshipResult> {
    const claimed = await this.engine.claim({
      aggregate: { type: "CHAMPIONSHIP", id: championshipId },
      owner,
      trigger,
      codeRevision: this.runtimeRevision,
    });
    if (claimed.status !== "claimed") return claimed;
    const revisionId = claimed.claim.attemptId;
    try {
      const { output } = await this.snapshotAndCalculate(claimed.claim);
      const result = await this.engine.publish(claimed.claim, {
        apply: async (tx, context) => {
          const storedOutput = context.output as unknown as ChampionshipSettlementOutput;
          if (storedOutput.championshipId !== output.championshipId) {
            throw new Error("Career championship output does not match the claimed championship");
          }
          for (const standing of output.standings) {
            await tx.careerChampionshipResult.update({
              where: {
                championshipId_slotNumber: {
                  championshipId,
                  slotNumber: standing.slotNumber,
                },
              },
              data: {
                rank: standing.rank,
                isWinner: standing.isWinner,
                relativeToPar: standing.relativeToPar,
                completed: standing.completed,
              },
            });
          }

          // Frozen Championship Legacy: immutable ledger rows, the human winner's
          // trophy, and a legacyTotal projection recomputed from the ledger. NO
          // movement / rating / season-history / enrollment effects are emitted.
          const legacy = deriveChampionshipLegacy(
            output.standings,
            requireCareerFormulaBundle(output.formulaVersion).legacyPoints,
          );
          const awardedProfiles = new Set<string>();
          for (const award of legacy.awards) {
            await tx.careerLegacyLedger.create({
              data: {
                profileId: award.profileId,
                sourceType: CAREER_CHAMPIONSHIP_SOURCE_TYPE,
                sourceId: championshipId,
                awardType: award.awardType,
                points: award.points,
                revisionId,
                payloadHash: canonicalHash({
                  profileId: award.profileId,
                  sourceType: CAREER_CHAMPIONSHIP_SOURCE_TYPE,
                  sourceId: championshipId,
                  awardType: award.awardType,
                  points: award.points,
                }),
              },
            });
            awardedProfiles.add(award.profileId);
          }
          if (legacy.trophyProfileId) {
            await tx.careerTrophy.create({
              data: {
                profileId: legacy.trophyProfileId,
                sourceType: CAREER_CHAMPIONSHIP_SOURCE_TYPE,
                sourceId: championshipId,
                trophyType: CAREER_CHAMPIONSHIP_TROPHY,
                revisionId,
              },
            });
          }
          for (const profileId of awardedProfiles) {
            const projected = await tx.careerLegacyLedger.aggregate({
              where: { profileId },
              _sum: { points: true },
            });
            await tx.careerProfile.update({
              where: { id: profileId },
              data: { legacyTotal: projected._sum.points ?? 0 },
            });
          }

          await tx.careerCompetition.updateMany({
            where: { championshipId, kind: "CHAMPIONSHIP" },
            data: { state: "SETTLED" },
          });
        },
      });
      return {
        status: "settled",
        championshipId,
        committedAttemptId: result.committedAttemptId ?? claimed.claim.attemptId,
        winnerCompetitorId: output.winnerCompetitorId,
      };
    } catch (error) {
      try {
        await this.engine.markRetryable(claimed.claim, "championship-settlement-failed", {
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
