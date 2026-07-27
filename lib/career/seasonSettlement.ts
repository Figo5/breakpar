/**
 * Career Mode — pure regular-season settlement calculation core.
 *
 * DATABASE-FREE by design, mirroring `eventSettlement.ts`'s split between a pure
 * `calculateCareerEventStandings` and its DB publication service. This module is
 * the deterministic heart of season settlement; a later iteration wires it into
 * `CareerSeasonSettlementService` via `CareerSettlementEngine` (atomic publish +
 * real-Postgres concurrency/idempotency tests).
 *
 * It reproduces the FROZEN `career-v1-freeze-candidate` behaviour exactly, using
 * the same functions the simulator's world loop uses (Candidate H rolling
 * movement, percentage cap with exact tie expansion, inactivity, promotion
 * carry, best-six-of-eight Tour Rating, the frozen Legacy schedule). It does NOT
 * retune anything. See docs/career-formula-freeze.md and
 * docs/career-settlement-recovery.md §5.2.
 */
import {
  ACTIVE_EVENT_MIN,
  blankLegacyAwardCounts,
  legacyPointBreakdown,
  promoteTier,
  rankSeason,
  relegateTier,
  seasonRating,
  tourRating,
  type CareerTier,
  type LegacyAwardCounts,
  type MovementAction,
  type RatingSeason,
  type SeasonCompetitor,
  type SeasonEventResult,
  type SeasonStanding,
} from "./rules";
import {
  ROLLING_DEFAULTS,
  activeSeasonPercentile,
  rollingHistoryAfterPromotion,
  rollingMovementForSeason,
} from "./simulator";
import { Prisma, type PrismaClient } from "@prisma/client";
import { hashSeed } from "@/lib/engine/rng";
import { canonicalHash, canonicalStringify } from "./canonical";
import { careerEffectKey } from "./effectKeys";
import { championshipUnlock } from "./championship";
import { CAREER_CURRENT_FORMULA_BUNDLE, CAREER_FORMULA_VERSION } from "./formulaBundle";
import {
  CareerSettlementEngine,
  type ClaimSettlementResult,
  type SettlementClaim,
  type SettlementEffect,
} from "./settlementEngine";
import { CAREER_NO_DEADLINE } from "./constants";
import {
  CAREER_BASE_FIELD_SIZE,
  CAREER_EVENTS_PER_SEASON,
  ensureCareerCohort,
  ensureCohortMembership,
} from "./world";
import type { CareerEventStanding } from "./eventSettlement";

/**
 * The pinned player-paced package (v2). Identical to the frozen v1 package for
 * every calibrated value; it differs only in retiring the human movement cap.
 */
const FROZEN = CAREER_CURRENT_FORMULA_BUNDLE;

/** Reason a competitor did not move by performance, when applicable. */
export type CareerMovementState = "normal";

/** One competitor as seen by season settlement. Humans and bots both supply the
 * four per-event standings that already committed in event finals. */
export interface SeasonSettlementCompetitor {
  readonly competitorId: string; // canonical, e.g. "human:{profileId}" / "bot:{botIdentityId}"
  readonly competitorType: "HUMAN" | "BOT";
  readonly profileId: string | null;
  readonly botIdentityId: string | null;
  /** The competitor's standing in each of the four committed event finals. */
  readonly events: readonly SeasonEventResult[];
  /** Deterministic display-only tiebreak draw (never submission time). */
  readonly fallbackDraw: number;
}

/** Prior committed profile state a human carries into this settlement. */
export interface SeasonSettlementProfileState {
  readonly profileId: string;
  readonly tier: CareerTier; // must equal the cohort tier
  /** Archival only — it must never gate progression. */
  readonly status: "ACTIVE" | "PAUSED" | "RETIRED";
  /** Seasons settled BEFORE this one; drives the Championship cycle. */
  readonly settledSeasons: number;
  /** ≤ window latest ACTIVE-season percentiles (movement evidence). */
  readonly movementEvidence: readonly number[];
  /** Chronological regular-season ratings BEFORE this season (for best-6-of-8). */
  readonly priorRatings: readonly RatingSeason[];
}

export interface CareerSeasonSettlementInput {
  readonly worldId: string;
  readonly cohortId: string;
  readonly seasonNumber: number;
  readonly tier: CareerTier;
  /** Event IDs indexed exactly like SeasonEventResult.eventIndex (0..3). */
  readonly eventIds: readonly string[];
  readonly competitors: readonly SeasonSettlementCompetitor[];
  /** Prior state for each HUMAN competitor, keyed by competitorId. */
  readonly humanState: Readonly<Record<string, SeasonSettlementProfileState>>;
}

export interface CareerHumanSeasonOutcome {
  readonly competitorId: string;
  readonly profileId: string;
  readonly active: boolean;
  readonly completedEvents: number;
  readonly rank: number | null; // rank among ACTIVE competitors (null if inactive)
  readonly activeFieldSize: number;
  readonly seasonPoints: number;
  readonly tier: CareerTier;
  readonly nextTier: CareerTier;
  readonly movement: MovementAction;
  readonly movementState: CareerMovementState;
  readonly nextMovementEvidence: readonly number[];
  readonly seasonRating: number;
  readonly tourRating: number;
  readonly legacyAwards: LegacyAwardCounts;
  readonly legacyBreakdown: Record<string, number>;
  readonly legacyEffects: readonly CareerLegacyEffect[];
  /** Set when this settlement completes a Championship cycle at Challenger+. */
  readonly championshipUnlock: { readonly cycleNumber: number } | null;
  readonly isSeasonChampion: boolean;
}

export interface CareerLegacyEffect {
  readonly sourceType: "event" | "season";
  readonly sourceId: string;
  readonly awardType: keyof LegacyAwardCounts;
  readonly points: number;
}

/** Ordered qualification contribution a Pro/Challenger cohort emits every fourth
 * season. The separate coordinator assembles the fixed 20-player field. */

export interface CareerSeasonSettlementOutput {
  readonly worldId: string;
  readonly cohortId: string;
  readonly seasonNumber: number;
  readonly tier: CareerTier;
  readonly formulaVersion: string;
  readonly fieldSize: number;
  readonly activeFieldSize: number;
  readonly humanMovementLimit: number | null;
  readonly humans: readonly CareerHumanSeasonOutcome[];
  /** Present only when this season is a Championship-qualification season. */
}

function frozenRollingOptions() {
  const movement = FROZEN.movement;
  return {
    window: movement.rollingWindow ?? ROLLING_DEFAULTS.window,
    promoteThreshold: movement.rollingPromoteThreshold ?? ROLLING_DEFAULTS.promoteThreshold,
    relegateThreshold: movement.rollingRelegateThreshold ?? ROLLING_DEFAULTS.relegateThreshold,
    minEntries: movement.rollingMinEntries ?? ROLLING_DEFAULTS.minEntries,
    promotionFloor: movement.rollingPromotionFloor,
    relegationCeiling: undefined as number | undefined,
  };
}


/** Legacy award counts a human earns from their own four event standings + the
 * settled season outcome. Championship qualification/win are NOT season effects. */
function humanLegacyAwards(
  events: readonly SeasonEventResult[],
  active: boolean,
  movement: MovementAction,
  tier: CareerTier,
  isSeasonChampion: boolean,
): LegacyAwardCounts {
  const awards = blankLegacyAwardCounts();
  for (const event of events) {
    if (event.rank == null) continue;
    awards.eventCompletion += 1;
    if (event.rank <= 5) awards.eventTopFive += 1;
    if (event.rank === 1) awards.eventWin += 1;
  }
  if (active) awards.activeSeasonCompletion += 1;
  if (movement === "promote") awards.promotion += 1;
  // Pro survival: an active Pro competitor who does not relegate held their tier.
  if (tier === "pro" && active && movement !== "relegate") awards.proSurvival += 1;
  if (isSeasonChampion) awards.seasonChampionship += 1;
  return awards;
}

function humanLegacyEffects(
  input: CareerSeasonSettlementInput,
  events: readonly SeasonEventResult[],
  awards: LegacyAwardCounts,
): CareerLegacyEffect[] {
  const effects: CareerLegacyEffect[] = [];
  const points = FROZEN.legacyPoints;
  for (const event of events) {
    const sourceId = input.eventIds[event.eventIndex];
    if (!sourceId) {
      throw new Error(`Career season settlement is missing event id ${event.eventIndex}`);
    }
    if (!event.completed || event.rank == null) continue;
    effects.push({
      sourceType: "event",
      sourceId,
      awardType: "eventCompletion",
      points: points.eventCompletion,
    });
    if (event.rank <= 5) {
      effects.push({
        sourceType: "event",
        sourceId,
        awardType: "eventTopFive",
        points: points.eventTopFive,
      });
    }
    if (event.rank === 1) {
      effects.push({
        sourceType: "event",
        sourceId,
        awardType: "eventWin",
        points: points.eventWin,
      });
    }
  }
  for (const awardType of [
    "activeSeasonCompletion",
    "promotion",
    "proSurvival",
    "seasonChampionship",
    // Earned by qualifying, not by playing — so it can never be stranded by an
    // unplayed Championship (docs/career-player-paced-design.md §6).
    "championshipQualification",
  ] as const) {
    if (awards[awardType] <= 0) continue;
    effects.push({
      sourceType: "season",
      sourceId: input.cohortId,
      awardType,
      points: awards[awardType] * points[awardType],
    });
  }
  return effects;
}

/**
 * Pure season settlement for ONE cohort (the settlement aggregate is the cohort).
 * Reproduces the frozen production movement/rating/Legacy behaviour deterministically.
 */
export function calculateCareerSeasonSettlement(
  input: CareerSeasonSettlementInput,
): CareerSeasonSettlementOutput {
  const { tier, seasonNumber } = input;
  if (
    input.eventIds.length !== 4
    || new Set(input.eventIds).size !== input.eventIds.length
    || input.eventIds.some((eventId) => eventId.trim().length === 0)
  ) {
    throw new Error("Career season settlement requires four unique event IDs");
  }

  // 1. Rank the full field (humans + bots) with the frozen best-three-of-four
  //    season math. Bots participate so percentile denominators are correct.
  const seasonCompetitors: SeasonCompetitor[] = input.competitors.map((competitor) => ({
    competitorId: competitor.competitorId,
    events: [...competitor.events],
    fallbackDraw: competitor.fallbackDraw,
  }));
  if (new Set(seasonCompetitors.map((competitor) => competitor.competitorId)).size !== seasonCompetitors.length) {
    throw new Error(`Career season settlement received duplicate competitors in cohort ${input.cohortId}`);
  }
  const standings = rankSeason(seasonCompetitors);
  const standingById = new Map(standings.map((standing) => [standing.competitorId, standing]));
  const activeStandings = standings.filter((standing) => standing.active);
  const activeRankById = new Map(activeStandings.map((standing, index) => [standing.competitorId, index + 1]));
  const seasonChampionId = activeStandings[0]?.competitorId ?? null;

  const humans = input.competitors.filter((competitor) => competitor.competitorType === "HUMAN");

  // 2. Proposed movement per human via Candidate H rolling evidence.
  const rollingOptions = frozenRollingOptions();
  const proposedMovement = new Map<string, MovementAction>();
  const nextRollingHistory = new Map<string, number[]>();
  for (const human of humans) {
    const state = input.humanState[human.competitorId];
    if (!state) throw new Error(`Missing prior state for human ${human.competitorId}`);
    if (state.tier !== tier) {
      throw new Error(`Human ${human.competitorId} tier ${state.tier} does not match cohort tier ${tier}`);
    }
    const standing = standingById.get(human.competitorId)!;
    if (!standing.active) {
      proposedMovement.set(human.competitorId, "inactive");
      continue;
    }
    const activeRank = activeRankById.get(human.competitorId)!;
    const rolling = rollingMovementForSeason(
      [...state.movementEvidence],
      activeSeasonPercentile(activeStandings.length, activeRank),
      tier,
      rollingOptions,
    );
    proposedMovement.set(human.competitorId, rolling.action);
    nextRollingHistory.set(human.competitorId, rolling.history);
  }

  // 3. The human movement cap is retired in the player-paced package: with one
  //    human per personal field it evaluated to 4 against a population of 1 and
  //    could never bind. See docs/career-player-paced-design.md §12.

  // 4. Commit each human's outcome: movement application, inactivity, rating,
  //    Legacy, evidence carry, and next-season enrollment decision.
  const outcomes: CareerHumanSeasonOutcome[] = humans.map((human) => {
    const state = input.humanState[human.competitorId];
    const standing = standingById.get(human.competitorId) as SeasonStanding;

    // A season only settles once all four events are complete, so every human
    // reaching settlement is active by construction. Inactivity is deleted in
    // player-paced Career; an inactive human here means a corrupt season.
    if (!standing.active) {
      throw new Error(
        `Career human ${human.competitorId} reached season settlement with only `
        + `${standing.completedEvents} completed events`,
      );
    }
    const active = true;
    const activeRank = activeRankById.get(human.competitorId)!;

    let movement: MovementAction = proposedMovement.get(human.competitorId) ?? "hold";
    const movementState: CareerMovementState = "normal";
    let nextTier = tier;
    let nextEvidence = nextRollingHistory.get(human.competitorId) ?? [...state.movementEvidence];

    if (movement === "promote") nextTier = promoteTier(tier);
    else if (movement === "relegate") nextTier = relegateTier(tier);
    if (nextTier !== tier) {
      nextEvidence = movement === "promote"
        ? rollingHistoryAfterPromotion(nextEvidence, FROZEN.movement.rollingPromotionCarryWeight)
        : [];
    }

    const rating = seasonRating(activeStandings.length, activeRank, tier, FROZEN.tourRating.tierMultipliers);
    const nextRatingHistory: RatingSeason[] = [...state.priorRatings, { rating, active }];
    const isSeasonChampion = seasonChampionId === human.competitorId;
    // Championship cycle: counted on the tier the player HOLDS once this
    // settlement lands (nextTier), i.e. the tier they will contest it at.
    const settledSeasons = state.settledSeasons + 1;
    const unlock = championshipUnlock(settledSeasons, DB_TIER[nextTier]);
    const legacyAwards = humanLegacyAwards(human.events, active, movement, tier, isSeasonChampion);
    if (unlock.unlocked) legacyAwards.championshipQualification += 1;


    return {
      competitorId: human.competitorId,
      profileId: state.profileId,
      active,
      completedEvents: standing.completedEvents,
      rank: activeRank,
      activeFieldSize: activeStandings.length,
      seasonPoints: standing.seasonPoints,
      tier,
      nextTier,
      movement,
      movementState,
      nextMovementEvidence: nextEvidence,
      seasonRating: rating,
      tourRating: tourRating(nextRatingHistory),
      legacyAwards,
      legacyBreakdown: legacyPointBreakdown(legacyAwards, FROZEN.legacyPoints),
      legacyEffects: humanLegacyEffects(input, human.events, legacyAwards),
      championshipUnlock: unlock.unlocked ? { cycleNumber: unlock.cycleNumber! } : null,
      isSeasonChampion,
    };
  });

  return {
    worldId: input.worldId,
    cohortId: input.cohortId,
    seasonNumber,
    tier,
    formulaVersion: FROZEN.id,
    fieldSize: standings.length,
    activeFieldSize: activeStandings.length,
    humanMovementLimit: null,
    humans: outcomes,
  };
}

export const CAREER_SEASON_ACTIVE_EVENT_MIN = ACTIVE_EVENT_MIN;

// ---------------------------------------------------------------------------
// Publication layer: wires the pure core through CareerSettlementEngine.
// Mirrors CareerEventSettlementService (claim → snapshot → calculateAndStage →
// publish({apply}) → markRetryable). All authoritative writes happen inside the
// single atomic publication transaction via deterministic effect keys.
// ---------------------------------------------------------------------------

const DB_TIER: Record<CareerTier, "LOCAL" | "CHALLENGER" | "PRO"> = {
  local: "LOCAL",
  challenger: "CHALLENGER",
  pro: "PRO",
};
const RULES_TIER: Record<"LOCAL" | "CHALLENGER" | "PRO", CareerTier> = {
  LOCAL: "local",
  CHALLENGER: "challenger",
  PRO: "pro",
};
const DB_MOVEMENT: Record<MovementAction, "PROMOTE" | "HOLD" | "RELEGATE" | "INACTIVE"> = {
  promote: "PROMOTE",
  hold: "HOLD",
  relegate: "RELEGATE",
  inactive: "INACTIVE",
};

export const CAREER_SEASON_SOURCE_TYPE = "season";
export const CAREER_SEASON_CHAMPION_TROPHY = "season-championship";

export type SettleCareerSeasonResult =
  | { readonly status: "settled"; readonly cohortId: string; readonly committedAttemptId: string }
  | Exclude<ClaimSettlementResult, { status: "claimed" }>;

interface SeasonSettlementOptions {
  readonly runtimeRevision?: string;
  /** Test-only fault injection inside the atomic publication transaction. */
  readonly beforePublishCommit?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/** A human's userId + prior projection state, needed to write next-season
 * enrollment and profile projections inside the atomic publish transaction. */
interface HumanPublishContext {
  readonly profileId: string;
  readonly userId: string;
}

interface SeasonSnapshotResult {
  readonly output: CareerSeasonSettlementOutput;
  readonly effects: readonly SettlementEffect[];
  readonly inputHash: string;
  readonly outputHash: string;
  readonly worldId: string;
  readonly worldKey: string;
  readonly humanContext: ReadonlyMap<string, HumanPublishContext>;
  readonly championshipId: string | null;
}

function persistedJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(canonicalStringify(value)) as Prisma.JsonValue;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return persistedJson(value) as Prisma.InputJsonValue;
}

/**
 * Publication service for regular-season settlement. Wires the pure
 * `calculateCareerSeasonSettlement` through `CareerSettlementEngine`, mirroring
 * `CareerEventSettlementService`: claim → snapshot → calculateAndStage → publish
 * ({apply}) → markRetryable. Every authoritative write lands in the single atomic
 * publish transaction under deterministic `careerEffectKey.*` keys, so retries
 * are idempotent and rolled-back attempts are invisible.
 */
export class CareerSeasonSettlementService {
  private readonly engine: CareerSettlementEngine;
  private readonly runtimeRevision: string;
  private readonly beforePublishCommit?: SeasonSettlementOptions["beforePublishCommit"];

  constructor(
    private readonly db: PrismaClient,
    options: SeasonSettlementOptions = {},
  ) {
    this.engine = new CareerSettlementEngine(db);
    this.runtimeRevision = options.runtimeRevision ?? "career-runtime-development";
    this.beforePublishCommit = options.beforePublishCommit;
  }

  /**
   * Transition ACTIVE cohorts whose four events have all SETTLED into ENDED,
   * making them eligible for the SEASON claim. Idempotent and CAS-guarded.
   */
  async closeDue(_now = new Date()): Promise<number> {
    const candidates = await this.db.careerCohort.findMany({
      where: { state: "ACTIVE" },
      select: {
        id: true,
        competitions: { where: { kind: "EVENT" }, select: { state: true } },
      },
    });
    let closed = 0;
    for (const cohort of candidates) {
      const events = cohort.competitions;
      if (events.length !== CAREER_EVENTS_PER_SEASON) continue;
      if (!events.every((event) => event.state === "SETTLED")) continue;
      const updated = await this.db.careerCohort.updateMany({
        where: { id: cohort.id, state: "ACTIVE" },
        data: {
          state: "ENDED",
          claimOwner: null,
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
      closed += updated.count;
    }
    return closed;
  }

  private async snapshotAndCalculate(claim: SettlementClaim): Promise<SeasonSnapshotResult> {
    const cohort = await this.db.careerCohort.findUniqueOrThrow({
      where: { id: claim.aggregate.id },
      include: {
        world: true,
        members: { include: { profile: true } },
        competitions: {
          where: { kind: "EVENT" },
          orderBy: { eventNumber: "asc" },
          include: {
            finals: true,
            lockRevisions: {
              select: {
                id: true,
                revision: true,
                lockHash: true,
                slots: {
                  orderBy: { slotId: "asc" },
                  select: {
                    competitorType: true,
                    profileId: true,
                    botIdentityId: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (cohort.state !== "ENDED") {
      throw new Error(`Career cohort ${cohort.id} is not eligible for season settlement`);
    }
    if (cohort.competitions.length !== CAREER_EVENTS_PER_SEASON) {
      throw new Error(`Career cohort ${cohort.id} does not have exactly four events`);
    }
    if (
      cohort.competitions.map((competition) => competition.eventNumber).join(",") !== "1,2,3,4"
    ) {
      throw new Error(`Career cohort ${cohort.id} has invalid event identities`);
    }

    // Load each event's single committed final, pinned to the frozen formula.
    const finals = cohort.competitions.map((competition) => {
      if (competition.state !== "SETTLED") {
        throw new Error(`Career event ${competition.id} is not settled`);
      }
      const committed = competition.finals.filter(
        (final) => final.formulaVersion === CAREER_FORMULA_VERSION,
      );
      if (committed.length !== 1) {
        throw new Error(
          `Career event ${competition.id} must have exactly one committed final for ${CAREER_FORMULA_VERSION}`,
        );
      }
      if (competition.lockRevisions.length !== 1) {
        throw new Error(`Career event ${competition.id} must have exactly one lock revision`);
      }
      const lock = competition.lockRevisions[0];
      const final = committed[0];
      if (final.lockRevisionId !== lock.id) {
        throw new Error(`Career event ${competition.id} final references the wrong lock revision`);
      }
      if (canonicalHash(final.standings) !== final.outputHash) {
        throw new Error(`Career event ${competition.id} final standings hash is invalid`);
      }
      if (!Array.isArray(final.standings) || final.standings.length !== lock.slots.length) {
        throw new Error(`Career event ${competition.id} final does not match its locked field`);
      }
      const standings = final.standings as unknown as readonly CareerEventStanding[];
      const lockedIdentities = lock.slots.map((slot) =>
        slot.competitorType === "HUMAN"
          ? `human:${slot.profileId}`
          : `bot:${slot.botIdentityId}`
      ).sort();
      const finalIdentities = standings.map((standing) => standing.competitorId).sort();
      if (canonicalStringify(lockedIdentities) !== canonicalStringify(finalIdentities)) {
        throw new Error(`Career event ${competition.id} final identities do not match its lock`);
      }
      return {
        eventNumber: competition.eventNumber ?? 0,
        standings,
      };
    });

    // Verify the roster is identical and immutable across all four finals.
    const rosterKey = (standings: readonly CareerEventStanding[]) =>
      [...standings].map((standing) => standing.competitorId).sort().join("|");
    const canonicalRoster = rosterKey(finals[0].standings);
    for (const final of finals) {
      if (rosterKey(final.standings) !== canonicalRoster) {
        throw new Error(`Career cohort ${cohort.id} has a non-uniform roster across its events`);
      }
    }

    // Reassemble per-competitor four-event results from the committed finals.
    const byCompetitor = new Map<
      string,
      { standing: CareerEventStanding; events: SeasonEventResult[] }
    >();
    for (const final of finals) {
      const eventIndex = final.eventNumber - 1;
      for (const standing of final.standings) {
        const identity = standing.competitorType === "HUMAN"
          ? standing.profileId
          : standing.botIdentityId;
        if (
          !identity
          || standing.competitorId !== `${standing.competitorType.toLowerCase()}:${identity}`
          || !Number.isSafeInteger(standing.slotId)
          || standing.slotId < 1
          || !Number.isFinite(standing.points)
          || standing.points < 0
        ) {
          throw new Error(`Career event final contains an invalid standing identity or value`);
        }
        let entry = byCompetitor.get(standing.competitorId);
        if (!entry) {
          entry = { standing, events: [] };
          byCompetitor.set(standing.competitorId, entry);
        } else if (
          entry.standing.competitorType !== standing.competitorType
          || entry.standing.profileId !== standing.profileId
          || entry.standing.botIdentityId !== standing.botIdentityId
        ) {
          throw new Error(`Career competitor ${standing.competitorId} changed identity across events`);
        }
        entry.events.push({
          eventIndex,
          competitorId: standing.competitorId,
          completed: standing.completed,
          relativeToPar: standing.relativeToPar,
          rank: standing.rank,
          points: standing.points,
        });
      }
    }

    const profilesById = new Map(
      cohort.members.map((member) => [member.profileId, member.profile]),
    );
    const competitors: SeasonSettlementCompetitor[] = [];
    const humanState: Record<string, SeasonSettlementProfileState> = {};
    const humanContext = new Map<string, HumanPublishContext>();
    for (const [competitorId, entry] of byCompetitor) {
      const { standing } = entry;
      const events = [...entry.events].sort((left, right) => left.eventIndex - right.eventIndex);
      if (events.length !== CAREER_EVENTS_PER_SEASON) {
        throw new Error(`Career competitor ${competitorId} is missing event results`);
      }
      competitors.push({
        competitorId,
        competitorType: standing.competitorType,
        profileId: standing.profileId,
        botIdentityId: standing.botIdentityId,
        events,
        // Keep this as the stable uint32 itself rather than a derived fraction:
        // PostgreSQL JSONB can normalize long decimal representations, while
        // the ranking needs only deterministic relative order.
        fallbackDraw: hashSeed(`career:season-fallback:${cohort.id}:${competitorId}`),
      });
      if (standing.competitorType === "HUMAN") {
        const profileId = standing.profileId;
        if (!profileId) throw new Error(`Career human ${competitorId} has no profile id`);
        const profile = profilesById.get(profileId);
        if (!profile) {
          throw new Error(`Career human ${competitorId} is not a member of cohort ${cohort.id}`);
        }
        const priorRatings = await this.db.careerRatingHistory.findMany({
          where: {
            profileId,
            worldId: cohort.worldId,
            seasonNumber: { lt: cohort.seasonNumber },
          },
          orderBy: { seasonNumber: "asc" },
          select: { rating: true, active: true },
        });
        const movementEvidence = Array.isArray(profile.movementEvidence)
          ? profile.movementEvidence
          : [];
        if (
          movementEvidence.some((value) =>
            typeof value !== "number"
            || !Number.isFinite(value)
            || value < 0
            || value > 1
          )
        ) {
          throw new Error(`Career profile ${profileId} has invalid movement evidence`);
        }
        humanState[competitorId] = {
          profileId,
          tier: RULES_TIER[profile.tier],
          status: profile.status,
          settledSeasons: profile.settledSeasons,
          movementEvidence: movementEvidence as number[],
          priorRatings: priorRatings.map((rating) => ({ rating: rating.rating, active: rating.active })),
        };
        humanContext.set(profileId, { profileId, userId: profile.userId });
      }
    }
    const humanCompetitorIds = new Set(
      competitors
        .filter((competitor) => competitor.competitorType === "HUMAN")
        .map((competitor) => competitor.profileId),
    );
    if (
      humanCompetitorIds.size !== cohort.members.length
      || cohort.members.some((member) => !humanCompetitorIds.has(member.profileId))
    ) {
      throw new Error(`Career cohort ${cohort.id} final human roster does not match membership`);
    }

    const rebuiltInput: CareerSeasonSettlementInput = {
      worldId: cohort.worldId,
      cohortId: cohort.id,
      seasonNumber: cohort.seasonNumber,
      tier: RULES_TIER[cohort.tier],
      eventIds: cohort.competitions.map((competition) => competition.id),
      competitors,
      humanState,
    };
    let input = rebuiltInput;
    let inputHash: string;
    if (claim.resumedSnapshot) {
      const frozen = await this.engine.frozenInput(claim);
      if (frozen.formulaVersion !== CAREER_FORMULA_VERSION) {
        throw new Error(`Cannot resume unavailable Career formula ${frozen.formulaVersion}`);
      }
      input = frozen.input as unknown as CareerSeasonSettlementInput;
      if (
        input.cohortId !== cohort.id
        || input.worldId !== cohort.worldId
        || input.seasonNumber !== cohort.seasonNumber
      ) {
        throw new Error("Frozen Career season input does not match the claimed cohort");
      }
      inputHash = frozen.inputHash;
    } else {
      const snapshotted = await this.engine.snapshot(claim, {
        input,
        formulaVersion: CAREER_FORMULA_VERSION,
        runtimeRevision: this.runtimeRevision,
      });
      inputHash = snapshotted.inputHash;
    }
    const output = calculateCareerSeasonSettlement(input);
    if (output.formulaVersion !== CAREER_FORMULA_VERSION) {
      throw new Error(`Season settlement produced a non-frozen formula version ${output.formulaVersion}`);
    }

    // Championship shells are created inside the publish transaction below, so
    // the unlock and its qualification Legacy award land atomically.
    const championshipId: string | null = null;


    const effects: SettlementEffect[] = [
      {
        effectKey: careerEffectKey.seasonSettlement(
          cohort.id,
          cohort.seasonNumber,
          CAREER_FORMULA_VERSION,
        ),
        effectType: "season-settlement",
        scope: cohort.id,
        payload: {
          cohortId: cohort.id,
          seasonNumber: cohort.seasonNumber,
          tier: output.tier,
          activeFieldSize: output.activeFieldSize,
          humanMovementLimit: output.humanMovementLimit,
        },
      },
      {
        effectKey: careerEffectKey.outbox(
          inputHash,
          "season-settled",
          cohort.id,
        ),
        effectType: "season-settled",
        scope: cohort.id,
        payload: {
          cohortId: cohort.id,
          seasonNumber: cohort.seasonNumber,
          tier: output.tier,
        },
        isOutbox: true,
      },
    ];
    for (const human of output.humans) {
      const scope = human.profileId;
      effects.push({
        effectKey: careerEffectKey.seasonHistory(human.profileId, cohort.id, cohort.seasonNumber),
        effectType: "season-history",
        scope,
        payload: {
          profileId: human.profileId,
          tier: human.tier,
          nextTier: human.nextTier,
          active: human.active,
          rank: human.rank,
          seasonPoints: human.seasonPoints,
          movement: human.movement,
        },
      });
      effects.push({
        effectKey: careerEffectKey.movement(human.profileId, cohort.id, cohort.seasonNumber),
        effectType: "movement",
        scope,
        payload: {
          profileId: human.profileId,
          movement: human.movement,
          movementState: human.movementState,
          nextTier: human.nextTier,
          nextMovementEvidence: human.nextMovementEvidence,
        },
      });
      effects.push({
        effectKey: careerEffectKey.rating(human.profileId, cohort.id, cohort.seasonNumber),
        effectType: "rating",
        scope,
        payload: {
          profileId: human.profileId,
          seasonRating: human.seasonRating,
          tourRating: human.tourRating,
          active: human.active,
        },
      });
      for (const legacy of human.legacyEffects) {
        effects.push({
          effectKey: careerEffectKey.legacy(
            human.profileId,
            legacy.sourceType,
            legacy.sourceId,
            legacy.awardType,
          ),
          effectType: "legacy",
          scope,
          payload: { profileId: human.profileId, ...legacy },
        });
      }
      if (human.isSeasonChampion) {
        effects.push({
          effectKey: careerEffectKey.trophy(
            human.profileId,
            CAREER_SEASON_SOURCE_TYPE,
            cohort.id,
            CAREER_SEASON_CHAMPION_TROPHY,
          ),
          effectType: "trophy",
          scope,
          payload: { profileId: human.profileId, trophyType: CAREER_SEASON_CHAMPION_TROPHY },
        });
      }
    }
    const calculated = await this.engine.calculateAndStage(claim, output, effects);
    return {
      output,
      effects,
      inputHash,
      outputHash: calculated.outputHash,
      worldId: cohort.worldId,
      worldKey: cohort.world.worldKey,
      humanContext,
      championshipId,
    };
  }

  async settle(
    cohortId: string,
    owner: string,
    trigger: "cron" | "read-repair" | "manual" = "cron",
  ): Promise<SettleCareerSeasonResult> {
    const claimed = await this.engine.claim({
      aggregate: { type: "SEASON", id: cohortId },
      owner,
      trigger,
      codeRevision: this.runtimeRevision,
    });
    if (claimed.status !== "claimed") return claimed;
    try {
      const snapshot = await this.snapshotAndCalculate(claimed.claim);
      const { output, humanContext, championshipId } = snapshot;
      const revisionId = snapshot.inputHash;
      const seasonNumber = output.seasonNumber;
      const nextSeason = seasonNumber + 1;

      const result = await this.engine.publish(claimed.claim, {
        apply: async (tx, context) => {
          const storedOutput = context.output as unknown as CareerSeasonSettlementOutput;
          if (storedOutput.cohortId !== output.cohortId) {
            throw new Error("Career season output does not match the claimed cohort");
          }

          await tx.careerSeasonSettlement.create({
            data: {
              cohortId: output.cohortId,
              seasonNumber,
              formulaVersion: CAREER_FORMULA_VERSION,
              revision: 1,
              inputHash: snapshot.inputHash,
              outputHash: snapshot.outputHash,
            },
          });

          for (const human of output.humans) {
            await tx.careerSeasonHistory.create({
              data: {
                profileId: human.profileId,
                cohortId: output.cohortId,
                worldId: snapshot.worldId,
                seasonNumber,
                tier: DB_TIER[human.tier],
                nextTier: DB_TIER[human.nextTier],
                active: human.active,
                completedEvents: human.completedEvents,
                rank: human.rank,
                activeFieldSize: human.activeFieldSize,
                seasonPoints: human.seasonPoints,
                movement: DB_MOVEMENT[human.movement],
                evidence: jsonInput({
                  movementEvidence: human.nextMovementEvidence,
                  movementState: human.movementState,
                  isSeasonChampion: human.isSeasonChampion,
                }),
                revisionId,
              },
            });
            await tx.careerRatingHistory.create({
              data: {
                profileId: human.profileId,
                worldId: snapshot.worldId,
                seasonNumber,
                rating: human.seasonRating,
                active: human.active,
                tier: DB_TIER[human.tier],
              },
            });

            let legacyPointsTotal = 0;
            for (const legacy of human.legacyEffects) {
              legacyPointsTotal += legacy.points;
              await tx.careerLegacyLedger.create({
                data: {
                  profileId: human.profileId,
                  sourceType: legacy.sourceType,
                  sourceId: legacy.sourceId,
                  awardType: legacy.awardType,
                  points: legacy.points,
                  revisionId,
                  payloadHash: canonicalHash({
                    profileId: human.profileId,
                    ...legacy,
                  }),
                },
              });
            }
            if (human.isSeasonChampion) {
              await tx.careerTrophy.create({
                data: {
                  profileId: human.profileId,
                  sourceType: CAREER_SEASON_SOURCE_TYPE,
                  sourceId: output.cohortId,
                  trophyType: CAREER_SEASON_CHAMPION_TROPHY,
                  revisionId,
                },
              });
            }

            const projectedLegacy = await tx.careerLegacyLedger.aggregate({
              where: { profileId: human.profileId },
              _sum: { points: true },
            });
            const projected = await tx.careerProfile.updateMany({
              where: {
                id: human.profileId,
                worldId: snapshot.worldId,
                currentSeason: seasonNumber,
                tier: DB_TIER[human.tier],
              },
              data: {
                tier: DB_TIER[human.nextTier],
                movementEvidence: jsonInput(human.nextMovementEvidence),
                legacyTotal: projectedLegacy._sum.points ?? legacyPointsTotal,
                currentSeason: nextSeason,
                // Drives the Championship cycle (every fourth settled season).
                settledSeasons: { increment: 1 },
              },
            });
            if (projected.count !== 1) {
              throw new Error(`Career profile ${human.profileId} projection compare-and-set failed`);
            }
          }

          // Create next season for every human. Nothing gates continuation:
          // a season is always waiting, and `status` is archival only.
          const world = await tx.careerWorld.findUniqueOrThrow({
            where: { id: snapshot.worldId },
          });
          const nextTiers = new Set(output.humans.map((human) => DB_TIER[human.nextTier]));
          const nextCohorts = new Map<string, { cohortId: string; competitionIds: string[] }>();
          const tierOrder = ["LOCAL", "CHALLENGER", "PRO"] as const;
          for (const tier of tierOrder.filter((candidate) => nextTiers.has(candidate))) {
            const { cohort: nextCohort, competitions } = await ensureCareerCohort(tx, {
              world,
              seasonNumber: nextSeason,
              tier,
            });
            nextCohorts.set(tier, {
              cohortId: nextCohort.id,
              competitionIds: competitions.map((competition) => competition.id),
            });
          }
          for (const human of output.humans) {
            const context = humanContext.get(human.profileId);
            if (!context) throw new Error(`Missing publish context for human ${human.profileId}`);
            const target = nextCohorts.get(DB_TIER[human.nextTier])!;
            const competitions = await tx.careerCompetition.findMany({
              where: { id: { in: target.competitionIds } },
              orderBy: { eventNumber: "asc" },
            });
            await ensureCohortMembership(tx, {
              cohortId: target.cohortId,
              profileId: human.profileId,
              userId: context.userId,
              competitions,
            });
          }

          // Every fourth settled season at Challenger/Pro unlocks a Championship.
          // The shell is created here so it commits with the 35-point
          // qualification award; its FIELD is published afterwards, because
          // formation owns its own atomic boundary.
          for (const human of output.humans) {
            if (!human.championshipUnlock) continue;
            await tx.careerChampionship.upsert({
              where: {
                worldId_cycleNumber: {
                  worldId: snapshot.worldId,
                  cycleNumber: human.championshipUnlock.cycleNumber,
                },
              },
              create: {
                worldId: snapshot.worldId,
                cycleNumber: human.championshipUnlock.cycleNumber,
                state: "FORMING",
                deadlineAt: CAREER_NO_DEADLINE,
              },
              update: {},
            });
          }

          await this.beforePublishCommit?.(tx);
        },
      });

      return {
        status: "settled",
        cohortId,
        committedAttemptId: result.committedAttemptId ?? claimed.claim.attemptId,
      };
    } catch (error) {
      try {
        await this.engine.markRetryable(claimed.claim, "season-settlement-failed", {
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
