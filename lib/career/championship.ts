/**
 * Career Mode — Championship qualification and field publication (player-paced).
 *
 * A Championship unlocks on a PERSONAL cycle: every fourth settled season, and
 * only while the player sits at Challenger or Pro. There is no shared
 * population to rank, so the frozen cross-tier pass-down (Pro top-six → Pro
 * event winners → Challenger top-two) is retired; the field is simply the
 * qualifying player plus nineteen elite Ace bots from their own Journey roster.
 * See docs/career-player-paced-design.md §6.
 *
 * Split, like the rest of Career Mode, into a DATABASE-FREE pure core
 * (`assemblePersonalChampionshipField`, crown-course + elite-bot selection) and
 * a DB coordinator (`CareerChampionshipCoordinator`) that publishes atomically.
 *
 * Field publication is a FORMATION boundary, not a settlement one: it turns a
 * FORMING Championship shell into a playable competition with a locked field,
 * mirroring `formation.ts`'s advisory-locked, effect-ledgered publication. The
 * ENDED-gated settlement engine governs the later Championship *result*
 * settlement (`championshipSettlement.ts`).
 *
 * A Championship never expires and never blocks the next regular season.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { hashSeed } from "@/lib/engine/rng";

import {
  CAREER_CANONICAL_VERSION,
  canonicalHash,
  canonicalStringify,
  payloadHash,
} from "./canonical";
import { CAREER_NO_DEADLINE } from "./constants";
import { careerEffectKey } from "./effectKeys";
import type { ChampionshipSource } from "./rules";

export const CAREER_CHAMPIONSHIP_FIELD_SIZE = 20;
export const CAREER_CHAMPIONSHIP_SEASONS_PER_CYCLE = 4;

/** Tiers that may contest a Championship (approved product decision). */
export const CAREER_CHAMPIONSHIP_TIERS = ["CHALLENGER", "PRO"] as const;

/**
 * Does completing `settledSeasons` seasons at `tier` unlock a Championship?
 *
 * Cycles are counted, never granted retroactively: a player who completes a
 * cycle at Local unlocks nothing, and reaching Challenger later unlocks only
 * from their next completed cycle onward.
 */
export function championshipUnlock(
  settledSeasons: number,
  tier: "LOCAL" | "CHALLENGER" | "PRO",
): { readonly unlocked: boolean; readonly cycleNumber: number | null } {
  const completesCycle = settledSeasons > 0
    && settledSeasons % CAREER_CHAMPIONSHIP_SEASONS_PER_CYCLE === 0;
  if (!completesCycle) return { unlocked: false, cycleNumber: null };
  const eligibleTier = (CAREER_CHAMPIONSHIP_TIERS as readonly string[]).includes(tier);
  if (!eligibleTier) return { unlocked: false, cycleNumber: null };
  return { unlocked: true, cycleNumber: settledSeasons / CAREER_CHAMPIONSHIP_SEASONS_PER_CYCLE };
}

/** The frozen crown-jewel course pool. Sawgrass is NOT a fifth crown course. */
export const CAREER_CROWN_COURSE_SLUGS = [
  "augusta-national",
  "st-andrews-old",
  "pinehurst-no2",
  "royal-birkdale",
] as const;

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------


export interface ChampionshipFieldSlot {
  readonly slotNumber: number; // 1..20
  readonly competitorId: string;
  readonly competitorType: "HUMAN" | "BOT";
  readonly profileId: string | null;
  readonly botIdentityId: string | null;
  readonly source: ChampionshipSource;
}

/** Parse a canonical competitor id (`human:{profileId}` / `bot:{botIdentityId}`). */
export function parseChampionshipCompetitorId(id: string): {
  competitorType: "HUMAN" | "BOT";
  profileId: string | null;
  botIdentityId: string | null;
} {
  const separator = id.indexOf(":");
  if (separator <= 0) throw new Error(`Malformed career competitor id "${id}"`);
  const kind = id.slice(0, separator);
  const reference = id.slice(separator + 1);
  if (!reference) throw new Error(`Career competitor id "${id}" has no reference`);
  if (kind === "human") return { competitorType: "HUMAN", profileId: reference, botIdentityId: null };
  if (kind === "bot") return { competitorType: "BOT", profileId: null, botIdentityId: reference };
  throw new Error(`Unknown career competitor kind "${kind}" in "${id}"`);
}

/**
 * Deterministically order the world's persistent bot identities for elite-bot
 * fill. Ability (Ace) is applied at materialization time in a later iteration;
 * this only fixes a stable priority so the field is reproducible.
 */
export function orderEliteBotCompetitors(
  worldKey: string,
  cycleNumber: number,
  botIdentityIds: readonly string[],
): string[] {
  const namespace = `career:championship:${worldKey}:c${cycleNumber}:elite`;
  return [...botIdentityIds]
    .sort((left, right) =>
      hashSeed(`${namespace}:${left}`) - hashSeed(`${namespace}:${right}`)
      || left.localeCompare(right))
    .map((id) => `bot:${id}`);
}

/** Deterministically pick a crown course from the frozen pool ∩ seeded courses. */
export function selectCrownCourseSlug(
  worldKey: string,
  cycleNumber: number,
  availableSlugs: readonly string[],
): string {
  const available = new Set(availableSlugs);
  const pool = CAREER_CROWN_COURSE_SLUGS.filter((slug) => available.has(slug));
  if (pool.length === 0) {
    throw new Error("No crown-jewel course is seeded for the Championship");
  }
  const namespace = `career:championship:${worldKey}:c${cycleNumber}:crown`;
  return [...pool].sort((left, right) =>
    hashSeed(`${namespace}:${left}`) - hashSeed(`${namespace}:${right}`)
    || left.localeCompare(right))[0];
}

/**
 * Assemble the frozen, exactly-20 Championship field. Uses the frozen
 * `championshipField` pass-down builder and enforces the field invariants:
 * exactly 20 slots, exactly 20 unique competitors, deterministic ordering.
 */
export function assemblePersonalChampionshipField(
  humanCompetitorId: string,
  eliteBotCompetitorIds: readonly string[],
): ChampionshipFieldSlot[] {
  const ordered = [humanCompetitorId, ...eliteBotCompetitorIds];
  const seen = new Set<string>();
  const field: ChampionshipFieldSlot[] = [];
  for (const competitorId of ordered) {
    if (field.length >= CAREER_CHAMPIONSHIP_FIELD_SIZE) break;
    if (seen.has(competitorId)) continue;
    seen.add(competitorId);
    const parsed = parseChampionshipCompetitorId(competitorId);
    field.push({
      slotNumber: field.length + 1,
      competitorId,
      competitorType: parsed.competitorType,
      profileId: parsed.profileId,
      botIdentityId: parsed.botIdentityId,
      // The qualifying human holds slot 1; the rest is the elite Ace field.
      source: parsed.competitorType === "HUMAN" ? "pro-top-six" : "elite-bot",
    });
  }
  if (field.length !== CAREER_CHAMPIONSHIP_FIELD_SIZE) {
    throw new Error(
      `Championship field produced ${field.length} competitors; expected exactly `
      + `${CAREER_CHAMPIONSHIP_FIELD_SIZE}. Not enough elite bots to fill the field.`,
    );
  }
  if (field[0].competitorType !== "HUMAN") {
    throw new Error("Championship slot 1 must be the qualifying player");
  }
  return field;
}

// ---------------------------------------------------------------------------
// DB coordinator
// ---------------------------------------------------------------------------

interface QualificationSourceList {
  readonly orderedProfileIds: string[];
  readonly eventWinnerIds: string[];
}

function readSourceList(value: Prisma.JsonValue | null | undefined): QualificationSourceList {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Career qualification contribution has an invalid source list");
  }
  const record = value as Record<string, Prisma.JsonValue>;
  const ordered = record.orderedProfileIds;
  const winners = record.eventWinnerIds;
  const asStrings = (list: Prisma.JsonValue | undefined, label: string): string[] => {
    if (!Array.isArray(list)) throw new Error(`Career qualification contribution ${label} is not a list`);
    return list.map((entry) => {
      if (typeof entry !== "string") throw new Error(`Career qualification contribution ${label} has a non-string entry`);
      return entry;
    });
  };
  return {
    orderedProfileIds: asStrings(ordered, "orderedProfileIds"),
    eventWinnerIds: asStrings(winners, "eventWinnerIds"),
  };
}

const EMPTY_SOURCE_LIST: QualificationSourceList = { orderedProfileIds: [], eventWinnerIds: [] };

function persistedJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(canonicalStringify(value)) as Prisma.JsonValue;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return persistedJson(value) as Prisma.InputJsonValue;
}

export type PublishChampionshipFieldResult =
  | {
    readonly status: "published";
    readonly championshipId: string;
    readonly competitionId: string;
    readonly courseSlug: string;
    readonly fieldSize: number;
  }
  | {
    readonly status: "already-published";
    readonly championshipId: string;
    readonly competitionId: string;
  }
  | { readonly status: "not-ready"; readonly championshipId: string; readonly reason: string }
  | { readonly status: "not-found" };

interface ChampionshipCoordinatorOptions {
  readonly runtimeRevision?: string;
}

/**
 * Coordinates and publishes the Championship field after every fourth regular
 * season. Publication is atomic, idempotent, and advisory-locked so retries and
 * concurrent workers can never duplicate the competition or its slots.
 */
export class CareerChampionshipCoordinator {
  private readonly runtimeRevision: string;

  constructor(
    private readonly db: PrismaClient,
    options: ChampionshipCoordinatorOptions = {},
  ) {
    this.runtimeRevision = options.runtimeRevision ?? "career-runtime-development";
  }

  /** Publish every FORMING Championship whose cycle is ready. */
  async publishDue(now = new Date()): Promise<
    Array<{ championshipId: string; result: PublishChampionshipFieldResult }>
  > {
    const forming = await this.db.careerChampionship.findMany({
      where: { state: "FORMING" },
      select: { id: true },
    });
    const results: Array<{ championshipId: string; result: PublishChampionshipFieldResult }> = [];
    for (const championship of forming) {
      results.push({
        championshipId: championship.id,
        result: await this.publishField(championship.id, "career-championship-coordinator", now),
      });
    }
    return results;
  }

  async publishField(
    championshipId: string,
    owner: string,
    now = new Date(),
  ): Promise<PublishChampionshipFieldResult> {
    if (!championshipId.trim() || !owner.trim()) {
      throw new TypeError("Championship field publication requires a championship id and owner");
    }
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`career:championship-field:${championshipId}`}, 0))
      `;
      const championship = await tx.careerChampionship.findUnique({
        where: { id: championshipId },
        include: { world: true },
      });
      if (!championship) return { status: "not-found" } as const;

      const existingCompetition = await tx.careerCompetition.findFirst({
        where: { championshipId, kind: "CHAMPIONSHIP" },
        select: { id: true },
      });
      if (championship.state !== "FORMING") {
        if (existingCompetition) {
          return {
            status: "already-published",
            championshipId,
            competitionId: existingCompetition.id,
          } as const;
        }
        return {
          status: "not-ready",
          championshipId,
          reason: `championship is in state ${championship.state} with no published field`,
        } as const;
      }

      const cycleNumber = championship.cycleNumber;

      // Readiness is personal: the Journey's player must have completed at
      // least this cycle's worth of seasons, still at Challenger or Pro.
      const profile = await tx.careerProfile.findFirst({
        where: { worldId: championship.worldId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, tier: true, settledSeasons: true },
      });
      if (!profile) {
        return { status: "not-ready", championshipId, reason: "journey has no profile" } as const;
      }
      const requiredSeasons = cycleNumber * CAREER_CHAMPIONSHIP_SEASONS_PER_CYCLE;
      if (profile.settledSeasons < requiredSeasons) {
        return {
          status: "not-ready",
          championshipId,
          reason: `cycle ${cycleNumber} needs ${requiredSeasons} settled seasons, has ${profile.settledSeasons}`,
        } as const;
      }
      if (!(CAREER_CHAMPIONSHIP_TIERS as readonly string[]).includes(profile.tier)) {
        return {
          status: "not-ready",
          championshipId,
          reason: `tier ${profile.tier} may not contest a Championship`,
        } as const;
      }

      // Elite-bot fill draws from this Journey's persistent identities only.
      const bots = await tx.careerBotIdentity.findMany({
        where: { worldId: championship.worldId },
        select: { id: true },
      });
      const eliteBotCompetitorIds = orderEliteBotCompetitors(
        championship.world.worldKey,
        cycleNumber,
        bots.map((bot) => bot.id),
      );

      const field = assemblePersonalChampionshipField(
        `human:${profile.id}`,
        eliteBotCompetitorIds,
      );

      // Every human slot must tie to a Career Profile in this world; every bot
      // slot to a persistent Career Bot Identity in this world.
      const worldProfileIds = new Set(
        (await tx.careerProfile.findMany({
          where: { worldId: championship.worldId },
          select: { id: true },
        })).map((profile) => profile.id),
      );
      const worldBotIds = new Set(bots.map((bot) => bot.id));
      for (const slot of field) {
        if (slot.competitorType === "HUMAN") {
          if (!slot.profileId || !worldProfileIds.has(slot.profileId)) {
            throw new Error(`Championship human slot ${slot.slotNumber} is not a profile in world ${championship.worldId}`);
          }
        } else if (!slot.botIdentityId || !worldBotIds.has(slot.botIdentityId)) {
          throw new Error(`Championship bot slot ${slot.slotNumber} is not a persistent identity in world ${championship.worldId}`);
        }
      }

      // Deterministic crown course from the frozen pool ∩ seeded courses.
      const crownCourses = await tx.course.findMany({
        where: { slug: { in: [...CAREER_CROWN_COURSE_SLUGS] } },
        select: { id: true, slug: true },
      });
      const courseIdBySlug = new Map(crownCourses.map((course) => [course.slug, course.id]));
      const crownCourseSlug = selectCrownCourseSlug(
        championship.world.worldKey,
        cycleNumber,
        crownCourses.map((course) => course.slug),
      );
      const crownCourseId = courseIdBySlug.get(crownCourseSlug)!;

      // A Championship is playable immediately and never expires.
      const seedNamespace = `career:championship:${championship.world.worldKey}:c${cycleNumber}`;

      const canonicalInput = {
        canonicalVersion: CAREER_CANONICAL_VERSION,
        aggregate: { type: "CHAMPIONSHIP", id: championshipId },
        cycleNumber,
        qualifyingSeasons: requiredSeasons,
        formulaVersion: championship.formulaVersion,
        sources: {
          humanCompetitorId: `human:${profile.id}`,
          eliteBotCompetitorIds,
        },
        crownCourseSlug,
      };
      const inputHash = canonicalHash(canonicalInput);

      const competition = await tx.careerCompetition.create({
        data: {
          kind: "CHAMPIONSHIP",
          championshipId,
          courseId: crownCourseId,
          state: "ACTIVE",
          targetFieldSize: CAREER_CHAMPIONSHIP_FIELD_SIZE,
          unlocksAt: now,
          deadlineAt: CAREER_NO_DEADLINE,
        },
      });

      await tx.careerChampionshipSlot.createMany({
        data: field.map((slot) => ({
          championshipId,
          slotNumber: slot.slotNumber,
          competitorType: slot.competitorType,
          profileId: slot.profileId,
          botIdentityId: slot.botIdentityId,
          source: slot.source,
          sourceTrace: jsonInput({
            competitorId: slot.competitorId,
            source: slot.source,
            cycleNumber,
            seedNamespace,
          }),
        })),
      });

      // Deterministically-keyed committed effects: a per-slot qualification
      // effect plus a field-level effect. The globally unique effect key is a
      // hard idempotency backstop beneath the advisory lock + FORMING gate.
      const slotEffects = field.map((slot) => {
        const payload = persistedJson({
          championshipId,
          slotNumber: slot.slotNumber,
          competitorId: slot.competitorId,
          competitorType: slot.competitorType,
          profileId: slot.profileId,
          botIdentityId: slot.botIdentityId,
          source: slot.source,
        });
        return {
          effectKey: careerEffectKey.championshipSlot(championshipId, slot.slotNumber),
          effectType: "championship-slot",
          scope: slot.competitorId,
          payload,
          payloadHash: payloadHash({
            effectType: "championship-slot",
            scope: slot.competitorId,
            isOutbox: false,
            payload,
          }),
        };
      });
      const fieldPayload = persistedJson({
        championshipId,
        competitionId: competition.id,
        cycleNumber,
        crownCourseSlug,
        seedNamespace,
        fieldSize: CAREER_CHAMPIONSHIP_FIELD_SIZE,
      });
      const fieldEffect = {
        effectKey: careerEffectKey.championshipSettlement(
          championshipId,
          championship.formulaVersion,
        ),
        effectType: "championship-field",
        scope: championshipId,
        payload: fieldPayload,
        payloadHash: payloadHash({
          effectType: "championship-field",
          scope: championshipId,
          isOutbox: false,
          payload: fieldPayload,
        }),
      };
      await tx.careerCommittedEffect.createMany({
        data: [...slotEffects, fieldEffect].map((effect) => ({
          aggregateType: "CHAMPIONSHIP",
          aggregateId: championshipId,
          committedRevisionId: inputHash,
          effectKey: effect.effectKey,
          effectType: effect.effectType,
          scope: effect.scope,
          isOutbox: false,
          payload: jsonInput(effect.payload),
          payloadHash: effect.payloadHash,
        })),
      });
      await tx.careerOutbox.create({
        data: {
          committedRevisionId: inputHash,
          effectType: "championship-field-published",
          scope: championshipId,
          payload: jsonInput({
            championshipId,
            competitionId: competition.id,
            cycleNumber,
            crownCourseSlug,
            fieldSize: CAREER_CHAMPIONSHIP_FIELD_SIZE,
            seedNamespace,
          }),
        },
      });

      await tx.careerChampionship.update({
        where: { id: championshipId },
        data: { state: "ACTIVE", deadlineAt: CAREER_NO_DEADLINE },
      });

      return {
        status: "published",
        championshipId,
        competitionId: competition.id,
        courseSlug: crownCourseSlug,
        fieldSize: CAREER_CHAMPIONSHIP_FIELD_SIZE,
      } as const;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    });
  }
}
