/**
 * Play-by-play narration — the cheap, big win for "feel".
 *
 * Every resolved shot returns a short note of WHAT HAPPENED ("Drained it from
 * 12 feet 🐦", "Three-jacked from the fringe 😬"). Phrase pools are keyed by
 * (stage, result) and picked DETERMINISTICALLY from the shot seed, so a replay
 * always reads the same. Distance footage is woven in where it lands.
 */

import type { Lie } from "./shots";
import type { GreenResult, PuttResult, ScrambleResult, PuttBucket } from "./putting";

function pick(pool: string[], rng: () => number): string {
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

const TEE_NOTES: Record<Lie, string[]> = {
  dialed: ["Striped it right down the middle 🎯", "Bombed it — perfect position", "Flushed the drive, prime spot"],
  fairway: ["Found the short grass ⛳", "Solid swing, in the fairway", "Played it safe, clean look ahead"],
  rough: ["Drifted into the rough 🌿", "Caught the first cut", "Tugged it off the fairway"],
  trouble: ["Way offline — that's jail 🌋", "Blocked it into real trouble", "Yanked it dead into the hazard"],
};

const APPROACH_NOTES: Record<GreenResult, string[]> = {
  kickin: ["Stuffed it to a foot 🎯", "Dialed the approach — kick-in range", "Threw a dart, gimme left"],
  makeable: ["Hit the green with a real look", "On the dance floor, birdie chance", "Nice approach — makeable for birdie"],
  lag: ["On in reg, but miles away", "Found the green, long lag left", "Safely on — long two-putt territory"],
  scramble: ["Missed the green 😬", "Short-sided yourself", "Sailed it — chipping for par now"],
};

const PAR3_TEE_NOTES: Record<GreenResult, string[]> = {
  kickin: ["Tee shot to tap-in range 🎯", "Dart at the flag — gimme", "Nearly aced it!"],
  makeable: ["Tee shot to a birdie look", "On the green with a chance", "Good iron, makeable birdie"],
  lag: ["On the green, long way from the cup", "Safe tee shot, long putt left", "Found the putting surface, lag left"],
  scramble: ["Missed the green off the tee 😬", "Bunkered it off the tee", "Pushed the tee shot, scrambling now"],
};

const PUTT_NOTES: Record<PuttResult, Partial<Record<PuttBucket, string[]>>> = {
  oneputt: {
    short: ["Drained it from {ft} feet 🐦", "Buried the birdie putt from {ft}", "Centre cup from {ft} feet"],
    long: ["Snaked in a {ft}-footer! 😮", "Bombed the long one from {ft} feet", "Holed it from {ft} — unreal"],
  },
  twoputt: {
    short: ["Lipped out — tap-in for the next", "Cozied it close, easy two-putt", "Just missed, tidy two-putt"],
    long: ["Lagged it stone dead, two-putt", "Good speed from {ft}, two-putt", "Two-putt from distance, no drama"],
  },
  threeputt: {
    short: ["Yipped it — three-putt 😬", "Missed both, ugly three-putt", "Three-jacked from short range 😖"],
    long: ["Left the lag way short — three-putt 😬", "Three-jacked from {ft} feet", "Raced the first one by, three-putt"],
  },
};

const KICKIN_NOTES = ["Tapped it in 🎯", "Kick-in, no sweat", "Knocked in the gimme"];

const SCRAMBLE_NOTES: Record<ScrambleResult, string[]> = {
  updown: ["Flopped it stiff — easy save 👏", "Chipped it close, up and down", "Got it up and down like a pro"],
  twochip: ["Chipped on, two-putt bogey", "Couldn't get up and down", "On in three, walked off with bogey"],
  blowup: ["Bladed the chip across the green 😬", "Chunked it — scrambling for double", "Caught it heavy, double on the way"],
  disaster: ["Total mess from there 🌋", "Chip-chip-putt disaster", "It all unravelled — big number"],
};

function fmt(s: string, ft?: number): string {
  return ft == null ? s.replace(" from {ft} feet", "").replace("{ft}-footer", "long-range putt").replace("{ft}", "distance") : s.replaceAll("{ft}", String(ft));
}

export function teeNote(lie: Lie, rng: () => number): string {
  return pick(TEE_NOTES[lie], rng);
}

export function approachNote(green: GreenResult, isPar3: boolean, rng: () => number): string {
  return pick(isPar3 ? PAR3_TEE_NOTES[green] : APPROACH_NOTES[green], rng);
}

export function puttNote(result: PuttResult, bucket: PuttBucket, ft: number | undefined, rng: () => number): string {
  if (bucket === "tap") return pick(KICKIN_NOTES, rng);
  const pool = PUTT_NOTES[result][bucket === "short" ? "short" : "long"] ?? KICKIN_NOTES;
  return fmt(pick(pool, rng), ft);
}

export function scrambleNote(result: ScrambleResult, rng: () => number): string {
  return pick(SCRAMBLE_NOTES[result], rng);
}
