/**
 * Career Mode — shared structural constants.
 *
 * Extracted from `world.ts` so that `world.ts` can orchestrate field formation
 * without `formation.ts` importing back into it (which would be a cycle).
 */

/** Every Career field is exactly one human plus nineteen bots. */
export const CAREER_BASE_FIELD_SIZE = 20;

/** Human slots per personal field. Player-paced Career v1 is single-player. */
export const CAREER_HUMAN_SLOTS = 1;

/** Bot slots per personal field. */
export const CAREER_BOT_SLOTS = CAREER_BASE_FIELD_SIZE - CAREER_HUMAN_SLOTS;

/** Four one-round events per season; best three count. */
export const CAREER_EVENTS_PER_SEASON = 4;

/** Regular seasons per Championship cycle. */
export const CAREER_SEASONS_PER_CYCLE = 4;

/**
 * Player-paced Career has no deadlines: an event stays playable forever. The
 * `deadlineAt` column is non-null, so we store an explicit far-future sentinel
 * rather than a lie about "one week from now". Any residual `deadlineAt <= now`
 * comparison therefore never fires.
 */
export const CAREER_NO_DEADLINE = new Date("9999-12-31T00:00:00.000Z");

/** A player's Journey key. Its uniqueness enforces one Journey per player. */
export function careerJourneyKey(userId: string): string {
  const trimmed = userId.trim();
  if (trimmed.length === 0) throw new TypeError("Career journey key requires a user ID");
  return `journey:${trimmed}`;
}

/** True when a Journey key belongs to the player-paced (personal) generation. */
export function isCareerJourneyKey(worldKey: string): boolean {
  return worldKey.startsWith("journey:");
}
