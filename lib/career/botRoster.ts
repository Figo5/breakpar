import { hashSeed, mulberry32 } from "@/lib/engine/rng";

import {
  TENDENCIES,
  TIER_SCALED_BOT_MIX,
  botAbilityForSlot,
  type AbilityBand,
  type Tendency,
} from "./simulator";
import type { CareerTier } from "./rules";

export const CAREER_BOT_ROSTER_SIZE = 30;
export const CAREER_RECURRING_BOT_COUNT = 8;

const DISPLAY_NAMES = [
  "Alex Mercer", "Avery Brooks", "Blake Sutton", "Cameron Reed", "Casey Monroe",
  "Charlie Vaughn", "Drew Palmer", "Elliot Hayes", "Emerson Price", "Finley Grant",
  "Frankie Rhodes", "Harper Ellis", "Hayden Cole", "Jamie Foster", "Jordan Blake",
  "Kai Bennett", "Lane Morgan", "Logan Pierce", "Marley Quinn", "Micah Stone",
  "Morgan Hale", "Nico Barrett", "Parker Flynn", "Peyton Cross", "Quinn Sawyer",
  "Reese Dalton", "Riley Nash", "Robin Clarke", "Rowan Tate", "Sam Hollis",
  "Sawyer Dean", "Shawn Avery", "Skyler James", "Taylor Wynn", "Toby Marshall",
  "Tyler Knox", "Val Cameron", "Wesley Hart", "Winter Sloan", "Zion Perry",
] as const;

const HOME_FLAVORS = [
  "Pine Valley regular", "coastal wind specialist", "municipal-course grinder",
  "desert golf convert", "links-weather optimist", "club championship regular",
  "early-morning dew sweeper", "nine-hole league captain", "range rat",
  "weekend skins regular", "mountain-course local", "fast-greens specialist",
  "tree-line escape artist", "firm-fairway believer", "rain-glove loyalist",
  "match-play troublemaker", "short-game obsessive", "fairway-first planner",
  "late-round closer", "home-course historian", "bunker-practice regular",
  "walk-only traditionalist", "wind-reader", "winter golf diehard",
  "public-course lifer", "yardage-book collector", "twilight tee-time regular",
  "clubhouse putting champion", "risk-reward enthusiast", "old-school shotmaker",
] as const;

export interface CareerBotIdentity {
  readonly botKey: string;
  readonly displayName: string;
  readonly homeFlavor: string;
  readonly tendency: Tendency;
  readonly recurring: boolean;
}

export interface CareerBotSlotRequest {
  readonly slotId: number;
  /** Zero-based position used by the frozen tier-mix draw. */
  readonly slotIndex?: number;
  /** Omit to derive a stable target tendency from the slot namespace. */
  readonly requiredTendency?: Tendency;
}

export interface CareerBotSlotAssignment {
  readonly slotId: number;
  readonly identity: CareerBotIdentity;
  readonly abilityBand: AbilityBand;
  readonly tendency: Tendency;
  readonly seedNamespace: string;
}

export interface AssignCareerBotSlotsOptions {
  readonly worldKey: string;
  readonly seasonNumber: number;
  readonly tier: CareerTier;
  readonly eventNumber: number;
  readonly slots: readonly CareerBotSlotRequest[];
  readonly roster?: readonly CareerBotIdentity[];
  /** Set false for tiers where recurring rivals should not receive preference. */
  readonly preferRecurring?: boolean;
}

/**
 * The roster seed is any stable, non-empty world key.
 *
 * Player-paced Career keys a Journey to its player (`journey:{userId}`), so the
 * old Eastern-civil-date requirement no longer applies. All that matters is that
 * the key is stable for the life of the Journey, which makes the 30 identities
 * and the 8 recurring rivals reproducible for that player forever.
 */
function validateWorldKey(worldKey: string): void {
  if (worldKey.trim().length === 0) {
    throw new TypeError("Career world key must be a non-empty stable key");
  }
}

function seededShuffle<T>(values: readonly T[], seed: string): T[] {
  const result = [...values];
  const random = mulberry32(hashSeed(seed));
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function botInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Pure, stable creation of the 30 identities owned by one Career World. */
export function generateCareerBotRoster(worldKey: string): readonly CareerBotIdentity[] {
  validateWorldKey(worldKey);
  const seed = `career:${worldKey}:bots`;
  const names = seededShuffle(DISPLAY_NAMES, `${seed}:names`).slice(0, CAREER_BOT_ROSTER_SIZE);
  const homes = seededShuffle(HOME_FLAVORS, `${seed}:homes`);
  const recurringSlots = new Set(
    seededShuffle(
      Array.from({ length: CAREER_BOT_ROSTER_SIZE }, (_, index) => index),
      `${seed}:recurring`,
    ).slice(0, CAREER_RECURRING_BOT_COUNT),
  );

  return Object.freeze(names.map((displayName, index) => Object.freeze({
    botKey: `bot-${String(index + 1).padStart(2, "0")}`,
    displayName,
    homeFlavor: homes[index],
    tendency: TENDENCIES[hashSeed(`${seed}:tendency:${index}`) % TENDENCIES.length],
    recurring: recurringSlots.has(index),
  })));
}

export function validateCareerBotRoster(
  roster: readonly CareerBotIdentity[],
): void {
  if (roster.length !== CAREER_BOT_ROSTER_SIZE) {
    throw new Error(
      `Career bot roster must contain exactly ${CAREER_BOT_ROSTER_SIZE} identities; received ${roster.length}`,
    );
  }
  if (new Set(roster.map((identity) => identity.botKey)).size !== roster.length) {
    throw new Error("Career bot roster contains duplicate bot keys");
  }
  if (new Set(roster.map((identity) => identity.displayName)).size !== roster.length) {
    throw new Error("Career bot roster contains duplicate display names");
  }
  if (roster.filter((identity) => identity.recurring).length !== CAREER_RECURRING_BOT_COUNT) {
    throw new Error(
      `Career bot roster must contain exactly ${CAREER_RECURRING_BOT_COUNT} recurring identities`,
    );
  }
  for (const identity of roster) {
    if (!identity.botKey || !identity.displayName || !identity.homeFlavor) {
      throw new Error("Career bot roster identities require a key, display name, and home flavor");
    }
    if (!(TENDENCIES as readonly string[]).includes(identity.tendency)) {
      throw new Error(`Career bot identity ${identity.botKey} has an invalid tendency`);
    }
  }
}

function deterministicCandidateOrder(
  candidates: readonly CareerBotIdentity[],
  seed: string,
): CareerBotIdentity[] {
  return [...candidates].sort((left, right) => {
    const leftDraw = hashSeed(`${seed}:${left.botKey}`);
    const rightDraw = hashSeed(`${seed}:${right.botKey}`);
    return leftDraw - rightDraw || left.botKey.localeCompare(right.botKey);
  });
}

/**
 * Assign unique identities and independent frozen ability bands to bot slots.
 * Returned order matches ascending slotId so the lock snapshot is canonical.
 */
export function assignCareerBotSlots(
  options: AssignCareerBotSlotsOptions,
): readonly CareerBotSlotAssignment[] {
  validateWorldKey(options.worldKey);
  if (!Number.isSafeInteger(options.seasonNumber) || options.seasonNumber < 1) {
    throw new TypeError("seasonNumber must be a positive safe integer");
  }
  if (!Number.isSafeInteger(options.eventNumber) || options.eventNumber < 1) {
    throw new TypeError("eventNumber must be a positive safe integer");
  }

  const roster = options.roster ?? generateCareerBotRoster(options.worldKey);
  validateCareerBotRoster(roster);
  if (options.slots.length > CAREER_BOT_ROSTER_SIZE) {
    throw new Error(
      `Career bot roster has ${CAREER_BOT_ROSTER_SIZE} identities for ${options.slots.length} slots`,
    );
  }

  const slots = [...options.slots].sort((left, right) => left.slotId - right.slotId);
  if (new Set(slots.map((slot) => slot.slotId)).size !== slots.length) {
    throw new Error("Career bot slot requests contain duplicate slot IDs");
  }
  const slotIndexes = slots.map((slot, position) => slot.slotIndex ?? position);
  if (new Set(slotIndexes).size !== slotIndexes.length) {
    throw new Error("Career bot slot requests contain duplicate slot indexes");
  }

  const used = new Set<string>();
  return Object.freeze(slots.map((slot, position) => {
    if (!Number.isSafeInteger(slot.slotId) || slot.slotId < 1) {
      throw new TypeError("slotId must be a positive safe integer");
    }
    const slotIndex = slotIndexes[position];
    if (!Number.isSafeInteger(slotIndex) || slotIndex < 0) {
      throw new TypeError("slotIndex must be a non-negative safe integer");
    }

    const seedNamespace =
      `career:${options.worldKey}:${options.seasonNumber}:${options.tier}:${options.eventNumber}:slot${slot.slotId}`;
    const requiredTendency = slot.requiredTendency
      ?? TENDENCIES[hashSeed(`${seedNamespace}:required-tendency`) % TENDENCIES.length];
    if (!(TENDENCIES as readonly string[]).includes(requiredTendency)) {
      throw new TypeError(`Slot ${slot.slotId} has an invalid required tendency`);
    }
    const available = roster.filter((identity) => !used.has(identity.botKey));
    const matching = available.filter((identity) => identity.tendency === requiredTendency);
    const other = available.filter((identity) => identity.tendency !== requiredTendency);
    const preferRecurring = options.preferRecurring ?? true;
    const groups = preferRecurring
      ? [
        matching.filter((identity) => identity.recurring),
        matching.filter((identity) => !identity.recurring),
        other.filter((identity) => identity.recurring),
        other.filter((identity) => !identity.recurring),
      ]
      : [matching, other];
    const candidates = groups.find((group) => group.length > 0);
    if (!candidates) throw new Error(`No bot identity available for slot ${slot.slotId}`);
    const identity = deterministicCandidateOrder(candidates, `${seedNamespace}:identity`)[0];
    used.add(identity.botKey);

    return Object.freeze({
      slotId: slot.slotId,
      identity,
      abilityBand: botAbilityForSlot(
        options.tier,
        slotIndex,
        `${options.worldKey}:s${options.seasonNumber}:${options.tier}`,
        "tier-scaled",
        TIER_SCALED_BOT_MIX,
      ),
      tendency: identity.tendency,
      seedNamespace,
    });
  }));
}
