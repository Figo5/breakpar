import {
  CareerAggregateType,
  CareerAttemptState,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  CAREER_CANONICAL_VERSION,
  canonicalHash,
  canonicalStringify,
  payloadHash,
} from "./canonical";
import {
  pinCareerFormulaBundle,
  requireCareerFormulaBundle,
} from "./formulaBundle";

export const DEFAULT_SETTLEMENT_LEASE_MS = 5 * 60 * 1000;

export type SettlementAggregateType = "EVENT" | "SEASON" | "CHAMPIONSHIP";

export interface SettlementAggregateRef {
  readonly type: SettlementAggregateType;
  readonly id: string;
}

export interface SettlementClaim {
  readonly aggregate: SettlementAggregateRef;
  readonly attemptId: string;
  readonly fencingToken: number;
  readonly owner: string;
  readonly leaseExpiresAt: Date;
  readonly resumedSnapshot: boolean;
}

export type ClaimSettlementResult =
  | { readonly status: "claimed"; readonly claim: SettlementClaim }
  | {
    readonly status: "already-claimed";
    readonly owner: string | null;
    readonly fencingToken: number;
    readonly leaseExpiresAt: Date | null;
  }
  | { readonly status: "already-settled"; readonly committedAttemptId: string | null }
  | { readonly status: "not-eligible"; readonly state: string }
  | { readonly status: "not-found" };

export interface ClaimSettlementInput {
  readonly aggregate: SettlementAggregateRef;
  readonly owner: string;
  readonly trigger: "cron" | "read-repair" | "manual";
  readonly codeRevision?: string;
  readonly leaseMs?: number;
}

export interface SnapshotSettlementInput {
  readonly input: unknown;
  readonly formulaVersion: string;
  readonly runtimeRevision: string;
}

export interface FrozenSettlementInput {
  readonly input: Prisma.JsonValue;
  readonly inputHash: string;
  readonly formulaVersion: string;
  readonly runtimeRevision: string;
}

export interface SettlementEffect {
  readonly effectKey: string;
  readonly effectType: string;
  readonly scope: string;
  readonly payload: unknown;
  readonly isOutbox?: boolean;
}

export interface StoredSettlementEffect {
  readonly effectKey: string;
  readonly effectType: string;
  readonly scope: string;
  readonly payload: Prisma.JsonValue;
  readonly payloadHash: string;
  readonly isOutbox: boolean;
}

export interface PublishSettlementContext {
  readonly claim: SettlementClaim;
  readonly output: Prisma.JsonValue;
  readonly effects: readonly StoredSettlementEffect[];
}

export interface PublishSettlementOptions {
  /**
   * Aggregate-specific immutable writes and projection CAS updates execute
   * inside the same publication transaction as the manifest and lifecycle.
   */
  readonly apply?: (
    tx: Prisma.TransactionClient,
    context: PublishSettlementContext,
  ) => Promise<void>;
}

export type PublishSettlementResult =
  | { readonly status: "committed"; readonly committedAttemptId: string }
  | { readonly status: "already-settled"; readonly committedAttemptId: string | null };

interface AggregateState {
  readonly state: string;
  readonly fencingToken: number;
  readonly claimOwner: string | null;
  readonly leaseExpiresAt: Date | null;
}

interface PreparedEffect extends StoredSettlementEffect {
  readonly payloadInput: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
}

interface StoredOutputSnapshot {
  readonly canonicalVersion: string;
  readonly result: Prisma.JsonValue;
  readonly expectedEffectCount: number;
  readonly effectManifest: ReadonlyArray<{
    effectKey: string;
    effectType: string;
    scope: string;
    isOutbox: boolean;
    payloadHash: string;
  }>;
}

interface StoredInputSnapshot {
  readonly canonicalVersion: string;
  readonly formula: {
    readonly formulaPackageVersion: string;
    readonly runtimeRevision: string;
    readonly bundle: Prisma.JsonValue;
  };
  readonly input: Prisma.JsonValue;
}

const ACTIVE_ATTEMPT_STATES: CareerAttemptState[] = [
  "CLAIMED",
  "SNAPSHOTTED",
  "CALCULATED",
];

export class SettlementFenceError extends Error {
  constructor(message = "Career settlement claim is stale, expired, or no longer current") {
    super(message);
    this.name = "SettlementFenceError";
  }
}

export class SettlementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementConflictError";
  }
}

export class SettlementStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementStateError";
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new TypeError(`${label} must not be empty`);
}

function persistedJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(canonicalStringify(value)) as Prisma.JsonValue;
}

function jsonInput(
  value: Prisma.JsonValue,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function attemptError(reason: string, details?: unknown): Prisma.InputJsonValue {
  return persistedJson({
    reason,
    details: details ?? null,
    recordedAt: new Date().toISOString(),
  }) as Prisma.InputJsonValue;
}

function prepareEffects(effects: readonly SettlementEffect[]): PreparedEffect[] {
  const keys = new Set<string>();
  const outboxScopes = new Set<string>();
  const prepared = effects.map((effect) => {
    requireNonEmpty(effect.effectKey, "effectKey");
    requireNonEmpty(effect.effectType, "effectType");
    requireNonEmpty(effect.scope, "scope");
    if (!effect.effectKey.startsWith("career:")) {
      throw new TypeError(`Career settlement effect key must use the career namespace: ${effect.effectKey}`);
    }
    if (keys.has(effect.effectKey)) {
      throw new SettlementConflictError(`Duplicate effect key in calculated manifest: ${effect.effectKey}`);
    }
    keys.add(effect.effectKey);

    const isOutbox = effect.isOutbox ?? false;
    if (isOutbox) {
      const identity = `${encodeURIComponent(effect.effectType)}:${encodeURIComponent(effect.scope)}`;
      if (outboxScopes.has(identity)) {
        throw new SettlementConflictError(
          `Duplicate outbox effect type/scope in calculated manifest: ${identity}`,
        );
      }
      outboxScopes.add(identity);
    }

    const payload = persistedJson(effect.payload);
    const payloadInput = jsonInput(payload);
    return {
      effectKey: effect.effectKey,
      effectType: effect.effectType,
      scope: effect.scope,
      payload,
      payloadInput,
      isOutbox,
      payloadHash: payloadHash({
        effectType: effect.effectType,
        scope: effect.scope,
        isOutbox,
        payload,
      }),
    };
  });
  return prepared.sort((left, right) => left.effectKey.localeCompare(right.effectKey));
}

function effectManifest(effects: readonly PreparedEffect[]): StoredOutputSnapshot["effectManifest"] {
  return effects.map(({ effectKey, effectType, scope, isOutbox, payloadHash: hash }) => ({
    effectKey,
    effectType,
    scope,
    isOutbox,
    payloadHash: hash,
  }));
}

function manifestsMatch(
  left: StoredOutputSnapshot["effectManifest"],
  right: StoredOutputSnapshot["effectManifest"],
): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function parseOutputSnapshot(value: Prisma.JsonValue | null): StoredOutputSnapshot {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new SettlementStateError("Calculated attempt is missing its output snapshot");
  }
  const candidate = value as Record<string, Prisma.JsonValue>;
  if (
    candidate.canonicalVersion !== CAREER_CANONICAL_VERSION
    || typeof candidate.expectedEffectCount !== "number"
    || !Array.isArray(candidate.effectManifest)
    || !("result" in candidate)
  ) {
    throw new SettlementStateError("Calculated attempt has an invalid output snapshot");
  }
  return candidate as unknown as StoredOutputSnapshot;
}

function parseInputSnapshot(value: Prisma.JsonValue | null): StoredInputSnapshot {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new SettlementStateError("Snapshotted attempt is missing its input snapshot");
  }
  const candidate = value as Record<string, Prisma.JsonValue>;
  const formula = candidate.formula;
  if (
    candidate.canonicalVersion !== CAREER_CANONICAL_VERSION
    || !("input" in candidate)
    || !formula
    || Array.isArray(formula)
    || typeof formula !== "object"
  ) {
    throw new SettlementStateError("Snapshotted attempt has an invalid input snapshot");
  }
  const formulaRecord = formula as Record<string, Prisma.JsonValue>;
  if (
    typeof formulaRecord.formulaPackageVersion !== "string"
    || typeof formulaRecord.runtimeRevision !== "string"
    || !("bundle" in formulaRecord)
  ) {
    throw new SettlementStateError("Snapshotted attempt has an invalid formula pin");
  }
  return candidate as unknown as StoredInputSnapshot;
}

async function readAggregate(
  tx: Prisma.TransactionClient,
  aggregate: SettlementAggregateRef,
): Promise<AggregateState | null> {
  if (aggregate.type === "EVENT") {
    return tx.careerCompetition.findFirst({
      where: { id: aggregate.id, kind: "EVENT" },
      select: {
        state: true,
        fencingToken: true,
        claimOwner: true,
        leaseExpiresAt: true,
      },
    });
  }
  if (aggregate.type === "SEASON") {
    return tx.careerCohort.findUnique({
      where: { id: aggregate.id },
      select: {
        state: true,
        fencingToken: true,
        claimOwner: true,
        leaseExpiresAt: true,
      },
    });
  }
  return tx.careerChampionship.findUnique({
    where: { id: aggregate.id },
    select: {
      state: true,
      fencingToken: true,
      claimOwner: true,
      leaseExpiresAt: true,
    },
  });
}

async function claimAggregateRow(
  tx: Prisma.TransactionClient,
  aggregate: SettlementAggregateRef,
  owner: string,
  leaseExpiresAt: Date,
): Promise<number | null> {
  let rows: Array<{ fencingToken: number }>;
  if (aggregate.type === "EVENT") {
    rows = await tx.$queryRaw<Array<{ fencingToken: number }>>(Prisma.sql`
      UPDATE "CareerCompetition"
      SET "fencingToken" = "fencingToken" + 1,
          "claimToken" = "fencingToken" + 1,
          "claimOwner" = ${owner},
          "leaseExpiresAt" = ${leaseExpiresAt}
      WHERE "id" = ${aggregate.id}
        AND "kind" = 'EVENT'
        AND "state" = 'ENDED'
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= CURRENT_TIMESTAMP)
      RETURNING "fencingToken"
    `);
  } else if (aggregate.type === "SEASON") {
    rows = await tx.$queryRaw<Array<{ fencingToken: number }>>(Prisma.sql`
      UPDATE "CareerCohort"
      SET "fencingToken" = "fencingToken" + 1,
          "claimToken" = "fencingToken" + 1,
          "claimOwner" = ${owner},
          "leaseExpiresAt" = ${leaseExpiresAt}
      WHERE "id" = ${aggregate.id}
        AND "state" = 'ENDED'
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= CURRENT_TIMESTAMP)
      RETURNING "fencingToken"
    `);
  } else {
    rows = await tx.$queryRaw<Array<{ fencingToken: number }>>(Prisma.sql`
      UPDATE "CareerChampionship"
      SET "fencingToken" = "fencingToken" + 1,
          "claimToken" = "fencingToken" + 1,
          "claimOwner" = ${owner},
          "leaseExpiresAt" = ${leaseExpiresAt}
      WHERE "id" = ${aggregate.id}
        AND "state" = 'ENDED'
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= CURRENT_TIMESTAMP)
      RETURNING "fencingToken"
    `);
  }
  return rows[0]?.fencingToken ?? null;
}

async function assertCurrentFence(
  tx: Prisma.TransactionClient,
  claim: SettlementClaim,
): Promise<boolean> {
  let rows: Array<{ id: string }>;
  if (claim.aggregate.type === "EVENT") {
    rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "CareerCompetition"
      SET "claimOwner" = "claimOwner"
      WHERE "id" = ${claim.aggregate.id}
        AND "kind" = 'EVENT'
        AND "state" = 'ENDED'
        AND "fencingToken" = ${claim.fencingToken}
        AND "claimToken" = ${claim.fencingToken}
        AND "claimOwner" = ${claim.owner}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
  } else if (claim.aggregate.type === "SEASON") {
    rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "CareerCohort"
      SET "claimOwner" = "claimOwner"
      WHERE "id" = ${claim.aggregate.id}
        AND "state" = 'ENDED'
        AND "fencingToken" = ${claim.fencingToken}
        AND "claimToken" = ${claim.fencingToken}
        AND "claimOwner" = ${claim.owner}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
  } else {
    rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "CareerChampionship"
      SET "claimOwner" = "claimOwner"
      WHERE "id" = ${claim.aggregate.id}
        AND "state" = 'ENDED'
        AND "fencingToken" = ${claim.fencingToken}
        AND "claimToken" = ${claim.fencingToken}
        AND "claimOwner" = ${claim.owner}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
  }
  return rows.length === 1;
}

async function clearAggregateClaim(
  tx: Prisma.TransactionClient,
  claim: SettlementClaim,
): Promise<number> {
  if (claim.aggregate.type === "EVENT") {
    const result = await tx.careerCompetition.updateMany({
      where: {
        id: claim.aggregate.id,
        kind: "EVENT",
        state: "ENDED",
        fencingToken: claim.fencingToken,
        claimToken: claim.fencingToken,
        claimOwner: claim.owner,
      },
      data: { claimOwner: null, claimToken: null, leaseExpiresAt: null },
    });
    return result.count;
  }
  if (claim.aggregate.type === "SEASON") {
    const result = await tx.careerCohort.updateMany({
      where: {
        id: claim.aggregate.id,
        state: "ENDED",
        fencingToken: claim.fencingToken,
        claimToken: claim.fencingToken,
        claimOwner: claim.owner,
      },
      data: { claimOwner: null, claimToken: null, leaseExpiresAt: null },
    });
    return result.count;
  }
  const result = await tx.careerChampionship.updateMany({
    where: {
      id: claim.aggregate.id,
      state: "ENDED",
      fencingToken: claim.fencingToken,
      claimToken: claim.fencingToken,
      claimOwner: claim.owner,
    },
    data: { claimOwner: null, claimToken: null, leaseExpiresAt: null },
  });
  return result.count;
}

async function settleAggregate(
  tx: Prisma.TransactionClient,
  claim: SettlementClaim,
): Promise<number> {
  let rows: Array<{ id: string }>;
  if (claim.aggregate.type === "EVENT") {
    rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "CareerCompetition"
      SET "state" = 'SETTLED',
          "claimOwner" = NULL,
          "claimToken" = NULL,
          "leaseExpiresAt" = NULL
      WHERE "id" = ${claim.aggregate.id}
        AND "kind" = 'EVENT'
        AND "state" = 'ENDED'
        AND "fencingToken" = ${claim.fencingToken}
        AND "claimToken" = ${claim.fencingToken}
        AND "claimOwner" = ${claim.owner}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
  } else if (claim.aggregate.type === "SEASON") {
    rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "CareerCohort"
      SET "state" = 'SETTLED',
          "settledAt" = CURRENT_TIMESTAMP,
          "claimOwner" = NULL,
          "claimToken" = NULL,
          "leaseExpiresAt" = NULL
      WHERE "id" = ${claim.aggregate.id}
        AND "state" = 'ENDED'
        AND "fencingToken" = ${claim.fencingToken}
        AND "claimToken" = ${claim.fencingToken}
        AND "claimOwner" = ${claim.owner}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
  } else {
    rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "CareerChampionship"
      SET "state" = 'SETTLED',
          "claimOwner" = NULL,
          "claimToken" = NULL,
          "leaseExpiresAt" = NULL
      WHERE "id" = ${claim.aggregate.id}
        AND "state" = 'ENDED'
        AND "fencingToken" = ${claim.fencingToken}
        AND "claimToken" = ${claim.fencingToken}
        AND "claimOwner" = ${claim.owner}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id"
    `);
  }
  return rows.length;
}

async function markManualReviewInTransaction(
  tx: Prisma.TransactionClient,
  claim: SettlementClaim,
  reason: string,
  details?: unknown,
): Promise<void> {
  await tx.careerSettlementAttempt.updateMany({
    where: {
      id: claim.attemptId,
      fencingToken: claim.fencingToken,
      state: { in: ACTIVE_ATTEMPT_STATES },
    },
    data: {
      state: "MANUAL_REVIEW",
      error: attemptError(reason, details),
    },
  });

  const common = {
    id: claim.aggregate.id,
    state: "ENDED" as const,
    fencingToken: claim.fencingToken,
    claimToken: claim.fencingToken,
    claimOwner: claim.owner,
  };
  const data = {
    state: "MANUAL_REVIEW" as const,
    claimOwner: null,
    claimToken: null,
    leaseExpiresAt: null,
  };
  if (claim.aggregate.type === "EVENT") {
    await tx.careerCompetition.updateMany({
      where: { ...common, kind: "EVENT" },
      data,
    });
  } else if (claim.aggregate.type === "SEASON") {
    await tx.careerCohort.updateMany({ where: common, data });
  } else {
    await tx.careerChampionship.updateMany({ where: common, data });
  }
}

async function committedAttemptId(
  tx: Prisma.TransactionClient,
  aggregate: SettlementAggregateRef,
): Promise<string | null> {
  const attempt = await tx.careerSettlementAttempt.findFirst({
    where: {
      aggregateType: aggregate.type,
      aggregateId: aggregate.id,
      state: "COMMITTED",
    },
    select: { id: true },
  });
  return attempt?.id ?? null;
}

export class CareerSettlementEngine {
  constructor(private readonly db: PrismaClient) {}

  async claim(input: ClaimSettlementInput): Promise<ClaimSettlementResult> {
    requireNonEmpty(input.aggregate.id, "aggregate id");
    requireNonEmpty(input.owner, "claim owner");
    const leaseMs = input.leaseMs ?? DEFAULT_SETTLEMENT_LEASE_MS;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new TypeError("Settlement leaseMs must be a positive safe integer");
    }
    const leaseExpiresAt = new Date(Date.now() + leaseMs);

    return this.db.$transaction(async (tx) => {
      const fencingToken = await claimAggregateRow(
        tx,
        input.aggregate,
        input.owner,
        leaseExpiresAt,
      );
      if (fencingToken == null) {
        const aggregate = await readAggregate(tx, input.aggregate);
        if (!aggregate) return { status: "not-found" } as const;
        if (aggregate.state === "SETTLED") {
          return {
            status: "already-settled",
            committedAttemptId: await committedAttemptId(tx, input.aggregate),
          } as const;
        }
        if (
          aggregate.state === "ENDED"
          && aggregate.leaseExpiresAt
          && aggregate.leaseExpiresAt.getTime() > Date.now()
        ) {
          return {
            status: "already-claimed",
            owner: aggregate.claimOwner,
            fencingToken: aggregate.fencingToken,
            leaseExpiresAt: aggregate.leaseExpiresAt,
          } as const;
        }
        return { status: "not-eligible", state: aggregate.state } as const;
      }

      const priorAttempt = await tx.careerSettlementAttempt.findFirst({
        where: {
          aggregateType: input.aggregate.type,
          aggregateId: input.aggregate.id,
          fencingToken: { lt: fencingToken },
        },
        orderBy: { fencingToken: "desc" },
      });
      const resumedSnapshot = Boolean(priorAttempt?.inputSnapshot && priorAttempt.inputHash);

      await tx.careerSettlementAttempt.updateMany({
        where: {
          aggregateType: input.aggregate.type,
          aggregateId: input.aggregate.id,
          fencingToken: { lt: fencingToken },
          state: { in: ACTIVE_ATTEMPT_STATES },
        },
        data: {
          state: "SUPERSEDED",
          error: attemptError("superseded-by-newer-fence", { fencingToken }),
        },
      });

      const attempt = await tx.careerSettlementAttempt.create({
        data: {
          aggregateType: input.aggregate.type as CareerAggregateType,
          aggregateId: input.aggregate.id,
          fencingToken,
          state: resumedSnapshot ? "SNAPSHOTTED" : "CLAIMED",
          owner: input.owner,
          trigger: input.trigger,
          codeRevision: input.codeRevision,
          leaseExpiresAt,
          formulaBundleVersion: priorAttempt?.formulaBundleVersion,
          inputHash: priorAttempt?.inputHash,
          inputSnapshot: priorAttempt?.inputSnapshot ?? undefined,
        },
      });

      return {
        status: "claimed",
        claim: {
          aggregate: input.aggregate,
          attemptId: attempt.id,
          fencingToken,
          owner: input.owner,
          leaseExpiresAt,
          resumedSnapshot,
        },
      } as const;
    });
  }

  async heartbeat(claim: SettlementClaim, leaseMs = DEFAULT_SETTLEMENT_LEASE_MS): Promise<Date> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new TypeError("Settlement leaseMs must be a positive safe integer");
    }
    const leaseExpiresAt = new Date(Date.now() + leaseMs);
    const renewed = await this.db.$transaction(async (tx) => {
      if (!await assertCurrentFence(tx, claim)) return false;
      const attempt = await tx.careerSettlementAttempt.updateMany({
        where: {
          id: claim.attemptId,
          fencingToken: claim.fencingToken,
          owner: claim.owner,
          state: { in: ACTIVE_ATTEMPT_STATES },
        },
        data: { leaseExpiresAt },
      });
      if (attempt.count !== 1) return false;

      if (claim.aggregate.type === "EVENT") {
        await tx.careerCompetition.update({
          where: { id: claim.aggregate.id },
          data: { leaseExpiresAt },
        });
      } else if (claim.aggregate.type === "SEASON") {
        await tx.careerCohort.update({
          where: { id: claim.aggregate.id },
          data: { leaseExpiresAt },
        });
      } else {
        await tx.careerChampionship.update({
          where: { id: claim.aggregate.id },
          data: { leaseExpiresAt },
        });
      }
      return true;
    });
    if (!renewed) throw new SettlementFenceError();
    return leaseExpiresAt;
  }

  async snapshot(
    claim: SettlementClaim,
    input: SnapshotSettlementInput,
  ): Promise<{ status: "snapshotted" | "unchanged"; inputHash: string }> {
    const pin = pinCareerFormulaBundle(input.formulaVersion, input.runtimeRevision);
    const snapshot = persistedJson({
      canonicalVersion: CAREER_CANONICAL_VERSION,
      aggregate: claim.aggregate,
      formula: pin,
      input: input.input,
    });
    const hash = canonicalHash(snapshot);

    const result = await this.db.$transaction(async (tx) => {
      if (!await assertCurrentFence(tx, claim)) return { kind: "fence" } as const;
      const attempt = await tx.careerSettlementAttempt.findUnique({
        where: { id: claim.attemptId },
      });
      if (!attempt || attempt.fencingToken !== claim.fencingToken || attempt.owner !== claim.owner) {
        return { kind: "fence" } as const;
      }
      if (attempt.state !== "CLAIMED") {
        if (
          ["SNAPSHOTTED", "CALCULATED"].includes(attempt.state)
          && attempt.inputHash === hash
        ) {
          return { kind: "unchanged" } as const;
        }
        await markManualReviewInTransaction(tx, claim, "immutable-input-mismatch", {
          existingHash: attempt.inputHash,
          proposedHash: hash,
          attemptState: attempt.state,
        });
        return { kind: "conflict" } as const;
      }

      const updated = await tx.careerSettlementAttempt.updateMany({
        where: {
          id: claim.attemptId,
          fencingToken: claim.fencingToken,
          owner: claim.owner,
          state: "CLAIMED",
        },
        data: {
          state: "SNAPSHOTTED",
          formulaBundleVersion: input.formulaVersion,
          inputHash: hash,
          inputSnapshot: jsonInput(snapshot),
        },
      });
      return updated.count === 1 ? { kind: "snapshotted" } as const : { kind: "fence" } as const;
    });

    if (result.kind === "fence") throw new SettlementFenceError();
    if (result.kind === "conflict") {
      throw new SettlementConflictError("A Career settlement input snapshot is immutable once captured");
    }
    return {
      status: result.kind === "unchanged" ? "unchanged" : "snapshotted",
      inputHash: hash,
    };
  }

  /** Read the immutable input copied onto a reclaimed attempt. Calculators use
   * this instead of rebuilding inputs from live rows after a lease/failure
   * retry, including retries running under a newer code revision. */
  async frozenInput(claim: SettlementClaim): Promise<FrozenSettlementInput> {
    const result = await this.db.$transaction(async (tx) => {
      if (!await assertCurrentFence(tx, claim)) return { kind: "fence" } as const;
      const attempt = await tx.careerSettlementAttempt.findUnique({
        where: { id: claim.attemptId },
        select: {
          state: true,
          fencingToken: true,
          owner: true,
          inputHash: true,
          inputSnapshot: true,
          formulaBundleVersion: true,
        },
      });
      if (
        !attempt
        || attempt.fencingToken !== claim.fencingToken
        || attempt.owner !== claim.owner
      ) {
        return { kind: "fence" } as const;
      }
      if (
        !["SNAPSHOTTED", "CALCULATED"].includes(attempt.state)
        || !attempt.inputHash
        || !attempt.inputSnapshot
        || !attempt.formulaBundleVersion
      ) {
        return { kind: "state" } as const;
      }
      if (canonicalHash(attempt.inputSnapshot) !== attempt.inputHash) {
        await markManualReviewInTransaction(tx, claim, "snapshot-hash-mismatch");
        return { kind: "conflict" } as const;
      }
      let snapshot: StoredInputSnapshot;
      try {
        snapshot = parseInputSnapshot(attempt.inputSnapshot);
      } catch (error) {
        await markManualReviewInTransaction(tx, claim, "invalid-snapshot-envelope", {
          message: error instanceof Error ? error.message : String(error),
        });
        return { kind: "conflict" } as const;
      }
      let registeredFormula: ReturnType<typeof requireCareerFormulaBundle>;
      try {
        registeredFormula = requireCareerFormulaBundle(attempt.formulaBundleVersion);
      } catch (error) {
        await markManualReviewInTransaction(tx, claim, "formula-package-unavailable", {
          formulaVersion: attempt.formulaBundleVersion,
          message: error instanceof Error ? error.message : String(error),
        });
        return { kind: "conflict" } as const;
      }
      if (
        snapshot.formula.formulaPackageVersion !== attempt.formulaBundleVersion
        || canonicalStringify(snapshot.formula.bundle) !== canonicalStringify(registeredFormula)
      ) {
        await markManualReviewInTransaction(tx, claim, "formula-bundle-mismatch");
        return { kind: "conflict" } as const;
      }
      return {
        kind: "ok",
        value: {
          input: snapshot.input,
          inputHash: attempt.inputHash,
          formulaVersion: snapshot.formula.formulaPackageVersion,
          runtimeRevision: snapshot.formula.runtimeRevision,
        },
      } as const;
    });
    if (result.kind === "fence") throw new SettlementFenceError();
    if (result.kind === "state") {
      throw new SettlementStateError("Settlement attempt has no frozen input to resume");
    }
    if (result.kind === "conflict") {
      throw new SettlementConflictError("Frozen Career settlement input failed verification");
    }
    return result.value;
  }

  async stageEffects(
    claim: SettlementClaim,
    effects: readonly SettlementEffect[],
  ): Promise<{ inserted: number; verified: number }> {
    const prepared = prepareEffects(effects);
    const result = await this.db.$transaction(async (tx) => {
      if (!await assertCurrentFence(tx, claim)) return { kind: "fence" } as const;
      const attempt = await tx.careerSettlementAttempt.findUnique({
        where: { id: claim.attemptId },
        select: { state: true, fencingToken: true, owner: true },
      });
      if (
        !attempt
        || attempt.fencingToken !== claim.fencingToken
        || attempt.owner !== claim.owner
        || !["SNAPSHOTTED", "CALCULATED"].includes(attempt.state)
      ) {
        return { kind: "state" } as const;
      }

      const existingBefore = await tx.careerStagedEffect.findMany({
        where: {
          attemptId: claim.attemptId,
          effectKey: { in: prepared.map((effect) => effect.effectKey) },
        },
        select: { effectKey: true, payloadHash: true },
      });
      if (
        attempt.state === "CALCULATED"
        && existingBefore.length !== prepared.length
      ) {
        await markManualReviewInTransaction(
          tx,
          claim,
          "effect-added-after-calculation",
          { proposedKeys: prepared.map((effect) => effect.effectKey) },
        );
        return { kind: "conflict" } as const;
      }

      await tx.careerStagedEffect.createMany({
        data: prepared.map((effect) => ({
          attemptId: claim.attemptId,
          effectKey: effect.effectKey,
          effectType: effect.effectType,
          scope: effect.scope,
          isOutbox: effect.isOutbox,
          payload: effect.payloadInput,
          payloadHash: effect.payloadHash,
        })),
        skipDuplicates: true,
      });
      const persisted = await tx.careerStagedEffect.findMany({
        where: {
          attemptId: claim.attemptId,
          effectKey: { in: prepared.map((effect) => effect.effectKey) },
        },
      });
      const byKey = new Map(persisted.map((effect) => [effect.effectKey, effect]));
      const mismatch = prepared.find((effect) => {
        const stored = byKey.get(effect.effectKey);
        return !stored
          || stored.payloadHash !== effect.payloadHash
          || stored.effectType !== effect.effectType
          || stored.scope !== effect.scope
          || stored.isOutbox !== effect.isOutbox;
      });
      if (mismatch) {
        await markManualReviewInTransaction(
          tx,
          claim,
          "staged-effect-payload-conflict",
          { effectKey: mismatch.effectKey },
        );
        return { kind: "conflict" } as const;
      }
      return {
        kind: "ok",
        inserted: prepared.length - existingBefore.length,
        verified: prepared.length,
      } as const;
    });

    if (result.kind === "fence") throw new SettlementFenceError();
    if (result.kind === "state") {
      throw new SettlementStateError("Effects can be staged only for a snapshotted calculation");
    }
    if (result.kind === "conflict") {
      throw new SettlementConflictError("Staged effect key was reused with different content");
    }
    return { inserted: result.inserted, verified: result.verified };
  }

  async finalizeCalculation(
    claim: SettlementClaim,
    output: unknown,
    expectedEffects: readonly SettlementEffect[],
  ): Promise<{ status: "calculated" | "unchanged"; outputHash: string }> {
    const prepared = prepareEffects(expectedEffects);
    const normalizedResult = persistedJson(output);
    const outputSnapshot = persistedJson({
      canonicalVersion: CAREER_CANONICAL_VERSION,
      result: normalizedResult,
      expectedEffectCount: prepared.length,
      effectManifest: effectManifest(prepared),
    });
    const hash = canonicalHash(outputSnapshot);

    const result = await this.db.$transaction(async (tx) => {
      if (!await assertCurrentFence(tx, claim)) return { kind: "fence" } as const;
      const attempt = await tx.careerSettlementAttempt.findUnique({
        where: { id: claim.attemptId },
      });
      if (!attempt || attempt.fencingToken !== claim.fencingToken || attempt.owner !== claim.owner) {
        return { kind: "fence" } as const;
      }
      if (attempt.state === "CALCULATED") {
        if (attempt.outputHash === hash) return { kind: "unchanged" } as const;
        await markManualReviewInTransaction(tx, claim, "deterministic-output-mismatch", {
          existingHash: attempt.outputHash,
          proposedHash: hash,
        });
        return { kind: "conflict" } as const;
      }
      if (attempt.state !== "SNAPSHOTTED") return { kind: "state" } as const;
      if (!attempt.inputHash) return { kind: "state" } as const;
      const expectedOutboxPrefix =
        `career:outbox:${encodeURIComponent(attempt.inputHash)}:`;
      const invalidOutbox = prepared.find(
        (effect) => effect.isOutbox && !effect.effectKey.startsWith(expectedOutboxPrefix),
      );
      if (invalidOutbox) {
        await markManualReviewInTransaction(tx, claim, "outbox-revision-key-mismatch", {
          effectKey: invalidOutbox.effectKey,
          expectedRevisionId: attempt.inputHash,
        });
        return { kind: "conflict" } as const;
      }

      const staged = await tx.careerStagedEffect.findMany({
        where: { attemptId: claim.attemptId },
        orderBy: { effectKey: "asc" },
      });
      const stagedManifest = staged.map((effect) => ({
        effectKey: effect.effectKey,
        effectType: effect.effectType,
        scope: effect.scope,
        isOutbox: effect.isOutbox,
        payloadHash: effect.payloadHash,
      }));
      if (!manifestsMatch(stagedManifest, effectManifest(prepared))) {
        return { kind: "incomplete" } as const;
      }

      const priorOutput = await tx.careerSettlementAttempt.findFirst({
        where: {
          aggregateType: claim.aggregate.type,
          aggregateId: claim.aggregate.id,
          fencingToken: { lt: claim.fencingToken },
          inputHash: attempt.inputHash,
          outputHash: { not: null },
        },
        orderBy: { fencingToken: "desc" },
        select: { outputHash: true },
      });
      if (priorOutput?.outputHash && priorOutput.outputHash !== hash) {
        await markManualReviewInTransaction(tx, claim, "superseded-output-mismatch", {
          priorHash: priorOutput.outputHash,
          proposedHash: hash,
        });
        return { kind: "conflict" } as const;
      }

      const updated = await tx.careerSettlementAttempt.updateMany({
        where: {
          id: claim.attemptId,
          state: "SNAPSHOTTED",
          fencingToken: claim.fencingToken,
          owner: claim.owner,
        },
        data: {
          state: "CALCULATED",
          outputSnapshot: jsonInput(outputSnapshot),
          outputHash: hash,
          expectedEffectCount: prepared.length,
        },
      });
      return updated.count === 1 ? { kind: "calculated" } as const : { kind: "fence" } as const;
    });

    if (result.kind === "fence") throw new SettlementFenceError();
    if (result.kind === "state") {
      throw new SettlementStateError("Only a snapshotted attempt can be calculated");
    }
    if (result.kind === "incomplete") {
      throw new SettlementStateError("Staged effect set does not match the calculated manifest");
    }
    if (result.kind === "conflict") {
      throw new SettlementConflictError("The same Career input and formula produced a different output");
    }
    return {
      status: result.kind === "unchanged" ? "unchanged" : "calculated",
      outputHash: hash,
    };
  }

  async calculateAndStage(
    claim: SettlementClaim,
    output: unknown,
    effects: readonly SettlementEffect[],
  ): Promise<{ status: "calculated" | "unchanged"; outputHash: string }> {
    await this.stageEffects(claim, effects);
    return this.finalizeCalculation(claim, output, effects);
  }

  async publish(
    claim: SettlementClaim,
    options: PublishSettlementOptions = {},
  ): Promise<PublishSettlementResult> {
    const result = await this.db.$transaction(async (tx) => {
      if (!await assertCurrentFence(tx, claim)) {
        const aggregate = await readAggregate(tx, claim.aggregate);
        if (aggregate?.state === "SETTLED") {
          const committedId = await committedAttemptId(tx, claim.aggregate);
          if (committedId !== claim.attemptId) return { kind: "fence" } as const;
          return {
            kind: "already-settled",
            committedAttemptId: committedId,
          } as const;
        }
        return { kind: "fence" } as const;
      }

      const attempt = await tx.careerSettlementAttempt.findUnique({
        where: { id: claim.attemptId },
      });
      if (
        !attempt
        || attempt.fencingToken !== claim.fencingToken
        || attempt.owner !== claim.owner
      ) {
        return { kind: "fence" } as const;
      }
      if (attempt.state !== "CALCULATED") return { kind: "state" } as const;
      if (
        !attempt.inputSnapshot
        || !attempt.outputSnapshot
        || !attempt.inputHash
        || !attempt.outputHash
        || !attempt.formulaBundleVersion
      ) {
        return { kind: "invalid" } as const;
      }
      let registeredFormula: ReturnType<typeof requireCareerFormulaBundle>;
      try {
        registeredFormula = requireCareerFormulaBundle(attempt.formulaBundleVersion);
      } catch (error) {
        await markManualReviewInTransaction(tx, claim, "formula-package-unavailable", {
          formulaVersion: attempt.formulaBundleVersion,
          message: error instanceof Error ? error.message : String(error),
        });
        return { kind: "conflict" } as const;
      }
      if (
        canonicalHash(attempt.inputSnapshot) !== attempt.inputHash
        || canonicalHash(attempt.outputSnapshot) !== attempt.outputHash
      ) {
        await markManualReviewInTransaction(tx, claim, "snapshot-hash-mismatch");
        return { kind: "conflict" } as const;
      }

      let inputSnapshot: StoredInputSnapshot;
      let outputSnapshot: StoredOutputSnapshot;
      try {
        inputSnapshot = parseInputSnapshot(attempt.inputSnapshot);
        outputSnapshot = parseOutputSnapshot(attempt.outputSnapshot);
      } catch (error) {
        await markManualReviewInTransaction(tx, claim, "invalid-snapshot-envelope", {
          message: error instanceof Error ? error.message : String(error),
        });
        return { kind: "conflict" } as const;
      }
      if (
        inputSnapshot.formula.formulaPackageVersion !== attempt.formulaBundleVersion
        || canonicalStringify(inputSnapshot.formula.bundle) !== canonicalStringify(registeredFormula)
      ) {
        await markManualReviewInTransaction(tx, claim, "formula-bundle-mismatch");
        return { kind: "conflict" } as const;
      }
      const staged = await tx.careerStagedEffect.findMany({
        where: { attemptId: claim.attemptId },
        orderBy: { effectKey: "asc" },
      });
      const stagedManifest = staged.map((effect) => ({
        effectKey: effect.effectKey,
        effectType: effect.effectType,
        scope: effect.scope,
        isOutbox: effect.isOutbox,
        payloadHash: effect.payloadHash,
      }));
      if (
        staged.length !== attempt.expectedEffectCount
        || staged.length !== outputSnapshot.expectedEffectCount
        || !manifestsMatch(stagedManifest, outputSnapshot.effectManifest)
      ) {
        await markManualReviewInTransaction(tx, claim, "effect-manifest-mismatch", {
          stagedCount: staged.length,
          attemptExpectedCount: attempt.expectedEffectCount,
          outputExpectedCount: outputSnapshot.expectedEffectCount,
        });
        return { kind: "conflict" } as const;
      }

      const conflicts = await tx.careerCommittedEffect.findMany({
        where: { effectKey: { in: staged.map((effect) => effect.effectKey) } },
        select: {
          effectKey: true,
          payloadHash: true,
          committedRevisionId: true,
        },
      });
      if (conflicts.length > 0) {
        await markManualReviewInTransaction(tx, claim, "committed-effect-key-conflict", conflicts);
        return { kind: "conflict" } as const;
      }

      const storedEffects: StoredSettlementEffect[] = staged.map((effect) => ({
        effectKey: effect.effectKey,
        effectType: effect.effectType,
        scope: effect.scope,
        isOutbox: effect.isOutbox,
        payload: effect.payload,
        payloadHash: effect.payloadHash,
      }));

      await tx.careerCommittedEffect.createMany({
        data: staged.map((effect) => ({
          aggregateType: claim.aggregate.type,
          aggregateId: claim.aggregate.id,
          committedRevisionId: attempt.inputHash!,
          effectKey: effect.effectKey,
          effectType: effect.effectType,
          scope: effect.scope,
          isOutbox: effect.isOutbox,
          payload: jsonInput(effect.payload),
          payloadHash: effect.payloadHash,
        })),
      });

      for (const effect of staged.filter((candidate) => candidate.isOutbox)) {
        await tx.careerOutbox.create({
          data: {
            committedRevisionId: attempt.inputHash,
            effectType: effect.effectType,
            scope: effect.scope,
            payload: jsonInput(effect.payload),
          },
        });
      }

      if (options.apply) {
        await options.apply(tx, {
          claim,
          output: outputSnapshot.result,
          effects: storedEffects,
        });
      }

      const committed = await tx.careerSettlementAttempt.updateMany({
        where: {
          id: claim.attemptId,
          state: "CALCULATED",
          fencingToken: claim.fencingToken,
          owner: claim.owner,
        },
        data: { state: "COMMITTED" },
      });
      if (committed.count !== 1 || await settleAggregate(tx, claim) !== 1) {
        throw new SettlementFenceError();
      }
      return { kind: "committed", committedAttemptId: claim.attemptId } as const;
    });

    if (result.kind === "fence") throw new SettlementFenceError();
    if (result.kind === "state") {
      throw new SettlementStateError("Only a calculated attempt can be published");
    }
    if (result.kind === "invalid") {
      throw new SettlementStateError("Calculated settlement failed its effect or hash preconditions");
    }
    if (result.kind === "conflict") {
      throw new SettlementConflictError("Settlement publication detected contradictory committed data");
    }
    if (result.kind === "already-settled") {
      return {
        status: "already-settled",
        committedAttemptId: result.committedAttemptId,
      };
    }
    return {
      status: "committed",
      committedAttemptId: result.committedAttemptId,
    };
  }

  async markRetryable(claim: SettlementClaim, reason: string, details?: unknown): Promise<void> {
    requireNonEmpty(reason, "retryable failure reason");
    const updated = await this.db.$transaction(async (tx) => {
      if (!await assertCurrentFence(tx, claim)) return false;
      const attempt = await tx.careerSettlementAttempt.updateMany({
        where: {
          id: claim.attemptId,
          state: { in: ACTIVE_ATTEMPT_STATES },
          fencingToken: claim.fencingToken,
          owner: claim.owner,
        },
        data: {
          state: "FAILED_RETRYABLE",
          error: attemptError(reason, details),
        },
      });
      if (attempt.count !== 1) return false;
      return await clearAggregateClaim(tx, claim) === 1;
    });
    if (!updated) throw new SettlementFenceError();
  }
}
