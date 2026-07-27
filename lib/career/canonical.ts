import { createHash } from "node:crypto";

import { dateKey } from "@/lib/daily";

/** Bump only by adding a new serializer; committed snapshots retain this value. */
export const CAREER_CANONICAL_VERSION = "career-canonical-json-v1" as const;

export type CanonicalPrimitive = null | boolean | number | string;
export type CanonicalValue =
  | CanonicalPrimitive
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export interface CareerCalendarInstant {
  utcInstant: string;
  easternDateKey: string;
}

function describePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "$";
  return `$${path.map((part) => typeof part === "number" ? `[${part}]` : `.${part}`).join("")}`;
}

function invalid(path: readonly (string | number)[], reason: string): never {
  throw new TypeError(`Cannot canonicalize ${describePath(path)}: ${reason}`);
}

function serialize(
  value: unknown,
  path: readonly (string | number)[],
  ancestors: ReadonlySet<object>,
): string {
  if (value === null) return "null";
  return serializeValue(value, path, ancestors);
}

/**
 * Significant digits a fractional number is canonicalized to.
 *
 * A JavaScript double needs up to 17 significant digits to round-trip exactly,
 * but PostgreSQL's `jsonb` normalizes stored numerics to 16, which silently
 * yields a DIFFERENT double when the value is read back. Settlement hashes its
 * snapshots and re-verifies them after that round trip, so a 17-digit value
 * fails verification and sends a perfectly healthy aggregate to MANUAL_REVIEW.
 *
 * This is reachable in ordinary play: when competitors tie, event points are the
 * average of the occupied positions, and that summation routinely lands on a
 * 17-digit value (e.g. nineteen bots tied at rank one → 52.631578947368425).
 *
 * 15 significant digits round-trip through both IEEE-754 and PostgreSQL, so
 * canonicalizing to 15 makes "serialize → persist → read → serialize" stable.
 * The change is ~1e-13 on a 0–100 points scale: far below any ranking threshold.
 */
export const CAREER_CANONICAL_SIGNIFICANT_DIGITS = 15;

function roundTripSafe(value: number): number {
  return Number(value.toPrecision(CAREER_CANONICAL_SIGNIFICANT_DIGITS));
}

function serializeValue(
  value: unknown,
  path: readonly (string | number)[],
  ancestors: ReadonlySet<object>,
): string {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(path, "numbers must be finite");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      invalid(path, "integers must be within JavaScript's safe integer range");
    }
    if (Object.is(value, -0)) return "0";
    if (Number.isInteger(value)) return JSON.stringify(value);
    return JSON.stringify(roundTripSafe(value));
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) invalid(path, "Date is invalid");
    return JSON.stringify(value.toISOString());
  }

  if (typeof value !== "object") {
    invalid(path, `${typeof value} is not valid persisted JSON; use an explicit null`);
  }

  if (ancestors.has(value)) invalid(path, "circular references are not supported");
  const nextAncestors = new Set(ancestors).add(value);

  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        invalid([...path, index], "sparse arrays are not supported; use an explicit null");
      }
      entries.push(serialize(value[index], [...path, index], nextAncestors));
    }
    return `[${entries.join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, "only plain objects, arrays, Date values, and JSON primitives are supported");
  }

  const object = value as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(object).length > 0) {
    invalid(path, "symbol properties are not valid persisted JSON");
  }
  const hiddenProperty = Object.getOwnPropertyNames(object)
    .find((key) => !Object.prototype.propertyIsEnumerable.call(object, key));
  if (hiddenProperty) {
    invalid([...path, hiddenProperty], "non-enumerable properties are not valid persisted JSON");
  }
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(object[key], [...path, key], nextAncestors)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Deterministic JSON serialization for immutable Career snapshots.
 *
 * Object keys are sorted. Array order is deliberately preserved: snapshot
 * builders must order field/result/effect arrays by their stable identities.
 * Undefined values and unsafe integers are rejected instead of being silently
 * dropped or rounded.
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value, [], new Set());
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalStringify(value), "utf8");
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalBytes(value));
}

export const inputHash = canonicalHash;
export const outputHash = canonicalHash;
export const payloadHash = canonicalHash;

/** Store both forms whenever a rule depends on the Eastern civil calendar. */
export function careerCalendarInstant(value: Date): CareerCalendarInstant {
  if (Number.isNaN(value.getTime())) throw new TypeError("Career calendar instant must be a valid Date");
  return {
    utcInstant: value.toISOString(),
    easternDateKey: dateKey(value),
  };
}
