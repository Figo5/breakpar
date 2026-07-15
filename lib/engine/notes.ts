/**
 * Play-by-play narration — the cheap, big win for "feel".
 *
 * Every resolved shot returns a short note of WHAT HAPPENED ("Drained it from
 * 12 feet", "Three-jacked from the fringe"). Phrase pools are keyed by
 * (stage, result) and picked DETERMINISTICALLY from the shot seed, so a replay
 * always reads the same. Distance footage is woven in where it lands.
 */

import type { Lie } from "./shots";
import type { GreenResult, PuttResult, ScrambleResult, PuttBucket } from "./putting";
import type { Decision, Outcome } from "./probabilities";

function pick(pool: string[], rng: () => number): string {
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

// Score words for the {score} narration token. Derived from the
// engine's Outcome (composeOutcome) so a note's score word can NEVER disagree
// with the actual score — the same "read engine truth" principle as the
// putt-label fix. A par-5 reached in two shifts every outcome one notch better
// (oneputt=eagle, twochip=par, blowup=bogey), and the words follow automatically.
const SCORE_WORD: Record<Outcome, string> = {
  eagle: "eagle",
  birdie: "birdie",
  par: "par",
  bogey: "bogey",
  double: "double",
  triple: "triple",
};

const TEE_NOTES: Record<Lie, string[]> = {
  dialed: ["Striped it right down the middle", "Bombed it — perfect position", "Flushed the drive, prime spot"],
  fairway: ["Found the short grass", "Solid swing, in the fairway", "Played it safe, clean look ahead"],
  rough: ["Drifted into the rough", "Caught the first cut", "Tugged it off the fairway"],
  trouble: ["Way offline — that's jail", "Blocked it into real trouble", "Yanked it dead into the hazard"],
};

const APPROACH_NOTES: Record<GreenResult, string[]> = {
  kickin: ["Stuffed it to a foot", "Dialed the approach — kick-in range", "Threw a dart, gimme left"],
  makeable: ["Hit the green with a real look", "On the dance floor, {score} chance", "Nice approach — makeable for {score}"],
  lag: ["On in reg, but miles away", "Found the green, long lag left", "Safely on — long two-putt territory"],
  scramble: ["Missed the green", "Short-sided yourself", "Sailed it — chipping for par now"],
};

// Par-5 layup (non-aggressive): the approach is the lay-up, then a wedge third
// sets up the green proximity. Makes the on-in-3 (par) scoring visible.
const LAYUP_APPROACH_NOTES = [
  "Laid up to wedge range",
  "Played safe — laying up short",
  "Took the lay-up, wedge in hand next",
];
const LAYUP_WEDGE_NOTES: Record<GreenResult, string[]> = {
  kickin: ["Wedged it stiff — kick-in", "Third to a foot, gimme left", "Dialed the wedge, tap-in range"],
  makeable: ["Wedge third to a birdie look", "Spun it close — makeable for birdie", "Wedge to the dance floor, real chance"],
  lag: ["Wedge on, but a long putt left", "Third found the green, lag from distance", "On in three — long two-putt territory"],
  scramble: ["Caught the wedge thin — missed the green", "Wedge third leaked off the green", "Chunked the lay-up wedge, scrambling now"],
};

const PAR3_TEE_NOTES: Record<GreenResult, string[]> = {
  kickin: ["Tee shot to tap-in range", "Dart at the flag — gimme", "Nearly aced it!"],
  makeable: ["Tee shot to a birdie look", "On the green with a chance", "Good iron, makeable birdie"],
  lag: ["On the green, long way from the cup", "Safe tee shot, long putt left", "Found the putting surface, lag left"],
  scramble: ["Missed the green off the tee", "Bunkered it off the tee", "Pushed the tee shot, scrambling now"],
};

// A lag/long putt (or a conservative one) that still three-putts is variance,
// not a bad choice — these notes read as bad luck so the "lag it close" /
// long-two-putt framing doesn't feel like a lie when it drops a shot anyway.
const LAG_THREEPUTT_NOTES = [
  "Played it safe and still got robbed — three from {ft}",
  "Perfect speed, wicked break — three-putt from {ft}",
  "Tough read; the lag stayed up — three from {ft} feet",
  "Did everything right, brutal three-putt from {ft}",
];

const PUTT_NOTES: Record<PuttResult, Partial<Record<PuttBucket, string[]>>> = {
  oneputt: {
    short: ["Drained the {score} from {ft} feet", "Buried the {score} putt from {ft}", "Centre cup from {ft} feet"],
    long: ["Snaked in a {ft}-footer!", "Bombed the long one from {ft} feet", "Holed it from {ft} — unreal"],
  },
  twoputt: {
    short: ["Lipped out — tap-in for the next", "Cozied it close, easy two-putt", "Just missed, tidy two-putt"],
    long: ["Lagged it stone dead, two-putt", "Good speed from {ft}, two-putt", "Two-putt from distance, no drama"],
  },
  threeputt: {
    short: ["Yipped it — three-putt", "Missed both, ugly three-putt", "Three-jacked from short range"],
    long: ["Left the lag way short — three-putt", "Three-jacked from {ft} feet", "Raced the first one by, three-putt"],
  },
};

const KICKIN_NOTES = ["Tapped it in", "Kick-in, no sweat", "Knocked in the gimme"];

const SCRAMBLE_NOTES: Record<ScrambleResult, string[]> = {
  updown: ["Flopped it stiff — easy save", "Chipped it close, up and down", "Got it up and down like a pro"],
  twochip: ["Chipped on, two-putt {score}", "Couldn't get up and down", "On in three, walked off with {score}"],
  blowup: ["Bladed the chip across the green", "Chunked it — scrambling for {score}", "Caught it heavy, {score} on the way"],
  disaster: ["Total mess from there", "Chip-chip-putt disaster", "It all unravelled — big number"],
};

// A SAFE punch that still blows up is the rare (~8%) variance tail, not a chunk
// you caused — these read as bad luck so the "kill the blow-up" framing on the
// safe choice doesn't feel like a lie when it occasionally drops two. Mirrors
// LAG_THREEPUTT_NOTES. Only used when the player chose safe (Punch).
const SAFE_SCRAMBLE_UNLUCKY = [
  "Played the safe punch and still caught a flyer — {score}",
  "Bump-and-run took a wicked bounce, {score} from nowhere",
  "Did the smart thing; a brutal lie beat you — {score}",
  "Safe play, cruel kick off the slope — {score} anyway",
];

function fmt(s: string, ft?: number, outcome?: Outcome): string {
  let out = ft == null
    ? s.replace(" from {ft} feet", "").replace("{ft}-footer", "long-range putt").replace("{ft}", "distance")
    : s.replaceAll("{ft}", String(ft));
  // {score} is filled from the engine's Outcome (never re-derived here).
  if (outcome) out = out.replaceAll("{score}", SCORE_WORD[outcome]);
  return out;
}

export function teeNote(lie: Lie, rng: () => number): string {
  return pick(TEE_NOTES[lie], rng);
}

export function approachNote(
  green: GreenResult,
  isPar3: boolean,
  rng: () => number,
  // The look a makeable approach is FOR: eagle on a par-5 reached in two, else
  // birdie. Par 3 (PAR3_TEE_NOTES) is always a birdie look and has no token.
  lookFor: Outcome = "birdie"
): string {
  return fmt(pick(isPar3 ? PAR3_TEE_NOTES[green] : APPROACH_NOTES[green], rng), undefined, lookFor);
}

export function puttNote(
  result: PuttResult,
  bucket: PuttBucket,
  ft: number | undefined,
  rng: () => number,
  decision?: Decision,
  // The actual scored Outcome (from composeOutcome). Fills {score} so the
  // word matches the score — e.g. a one-putt on a par-5 reached in two is eagle.
  outcome?: Outcome
): string {
  if (bucket === "tap") return pick(KICKIN_NOTES, rng);
  // Bad-luck note when the dropped shot comes from a position we framed as safe:
  // a conservative (Lag) putt OR any long/lag putt three-jacking despite the
  // "two-putt" read. Variance, not a bad call — so it doesn't feel like a lie.
  // Aggressive (Charge) is never excused — you accepted the three-jack risk.
  if (result === "threeputt" && decision !== "aggressive" && (decision === "safe" || bucket === "long"))
    return fmt(pick(LAG_THREEPUTT_NOTES, rng), ft, outcome);
  const pool = PUTT_NOTES[result][bucket === "short" ? "short" : "long"] ?? KICKIN_NOTES;
  return fmt(pick(pool, rng), ft, outcome);
}

export function scrambleNote(
  result: ScrambleResult,
  rng: () => number,
  decision?: Decision,
  outcome?: Outcome // actual scored Outcome; fills {score} so the word matches.
): string {
  // Bad-luck framing when a SAFE punch blows up: variance, not a bad call.
  if (decision === "safe" && (result === "blowup" || result === "disaster"))
    return fmt(pick(SAFE_SCRAMBLE_UNLUCKY, rng), undefined, outcome);
  return fmt(pick(SCRAMBLE_NOTES[result], rng), undefined, outcome);
}

/** Par-5 lay-up approach line (the 2nd shot, played safe short of the green). */
export function layupApproachNote(rng: () => number): string {
  return pick(LAYUP_APPROACH_NOTES, rng);
}

/** Par-5 wedge third — narrates the visible shot that explains on-in-3 scoring. */
export function layupNote(green: GreenResult, rng: () => number): string {
  return pick(LAYUP_WEDGE_NOTES[green], rng);
}
