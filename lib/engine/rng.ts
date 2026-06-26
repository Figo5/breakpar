/**
 * Deterministic, seedable RNG (mulberry32).
 *
 * Why deterministic? The hole result must be resolved on the SERVER and be
 * reproducible from (round id + hole number + a server secret). That makes
 * each hole idempotent — re-submitting can't "re-roll" a bad result — which
 * is the core anti-cheat property. The client never learns the seed.
 */

export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a) for deriving seeds. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed for a single hole resolution. SERVER_SEED keeps it unpredictable. */
export function holeSeed(roundId: string, holeNumber: number): number {
  const secret = process.env.SERVER_SEED ?? "dev-seed";
  return hashSeed(`${secret}:${roundId}:${holeNumber}`);
}
