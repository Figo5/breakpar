/**
 * Player-facing "reads" for a hole — the skill layer.
 *
 * Instead of handing the player the exact win probability (which turns the game
 * into solved EV arithmetic), we surface qualitative CUES they must interpret:
 * difficulty, hazards, wind, pin/greens. Good players learn to read these; the
 * exact odds stay server-side. Pure + dependency-light so it's easy to test.
 */

import { holeDifficulty, type HoleSpec } from "@/lib/engine/resolveHole";
import type { Lie, BreakDir, Slope } from "@/lib/engine/shots";
import type { Decision } from "@/lib/engine/probabilities";
import type { GreenResult, GreenSpeed, PuttBucket } from "@/lib/engine/putting";
import type { CourseHole } from "@/data/courses";

/**
 * Aggressive plays allowed per 18-hole round. The whole round only gets a
 * handful — deciding WHICH holes to spend them on is the core skill (an
 * allocation problem the player must solve with incomplete information).
 */
export const AGGRESSIVE_BUDGET = 8;

export interface Conditions {
  difficulty: number;
  wind: number;
}

export type Tone = "good" | "warn" | "bad";
export interface Cue {
  icon: string;
  text: string;
}

const specOf = (h: CourseHole): HoleSpec => ({
  number: h.number,
  par: h.par,
  strokeIndex: h.strokeIndex,
});

/** Coarse difficulty bucket: 0 = gettable, 1 = tough, 2 = brutal. */
export function difficultyBucket(h: CourseHole, c: Conditions): 0 | 1 | 2 {
  const d = holeDifficulty(specOf(h), c);
  return d < 0.34 ? 0 : d < 0.6 ? 1 : 2;
}

/**
 * Descriptive reads for a hole, ordered by importance and capped so the player
 * gets a glanceable picture rather than a spreadsheet. The leading cue always
 * conveys overall difficulty; the rest layer on the specific hazards.
 */
export function holeCues(h: CourseHole, c: Conditions, greens?: string): Cue[] {
  const cues: Cue[] = [];
  const bucket = difficultyBucket(h, c);

  cues.push(
    bucket === 0
      ? { icon: "🟢", text: "Gettable — green light" }
      : bucket === 1
        ? { icon: "🟡", text: "Pick your moment" }
        : { icon: "🔴", text: "Card-wrecker — respect it" }
  );

  if (h.strokeIndex <= 4) cues.push({ icon: "⚠️", text: `Signature test · SI ${h.strokeIndex}` });
  if (h.par === 5) cues.push({ icon: "🏌️", text: bucket === 0 ? "Reachable par 5" : "Long par 5" });
  if (h.par === 3) cues.push({ icon: "🎯", text: "One-shot par 3" });

  if (h.hazard === "ocean") cues.push({ icon: "🌊", text: "Ocean carry" });
  else if (h.hazard === "water") cues.push({ icon: "💧", text: "Water in play" });
  else if (h.hazard === "sand") cues.push({ icon: "🏖️", text: "Bunkers guard it" });

  if (h.dogleg === "L") cues.push({ icon: "↩️", text: "Dogleg left" });
  else if (h.dogleg === "R") cues.push({ icon: "↪️", text: "Dogleg right" });

  if (c.wind >= 18) cues.push({ icon: "💨", text: `Howling · ${c.wind} mph` });
  else if (c.wind >= 12) cues.push({ icon: "💨", text: `Breezy · ${c.wind} mph` });

  if (greens === "Fast" || greens === "Firm") cues.push({ icon: "⚡", text: "Slick greens" });

  return cues.slice(0, 4);
}

/**
 * Qualitative risk for a decision on this hole — a READ, not the exact odds.
 * Enough to inform a judgment call without solving the round for the player.
 */
export function riskRead(
  decision: Decision,
  h: CourseHole,
  c: Conditions
): { tone: Tone; text: string } {
  const bucket = difficultyBucket(h, c);
  if (decision === "safe") return { tone: "good", text: "Bankable" };
  if (decision === "normal")
    return bucket === 2 ? { tone: "warn", text: "Some risk" } : { tone: "good", text: "Solid" };
  // aggressive
  return bucket === 0
    ? { tone: "good", text: "Green light" }
    : bucket === 1
      ? { tone: "warn", text: "Risky" }
      : { tone: "bad", text: "Danger" };
}

/**
 * Risk read for the SCORING shot, given the lie you actually drew. This is the
 * punch-out-or-gamble call — the read depends on position, not just the hole.
 */
export function lieRiskRead(lie: Lie, decision: Decision): { tone: Tone; text: string } {
  if (decision === "safe") return { tone: "good", text: lie === "trouble" ? "Punch out" : "Bankable" };
  if (decision === "normal")
    return lie === "trouble" ? { tone: "warn", text: "Risky" } : { tone: "good", text: "Solid" };
  // aggressive — go for it
  if (lie === "dialed" || lie === "fairway") return { tone: "good", text: "Go for it" };
  if (lie === "rough") return { tone: "warn", text: "Risky" };
  return { tone: "bad", text: "Hero or bust" };
}

/**
 * Putt reads — qualitative cues for the green, never the exact make %. The
 * distance/break/speed are computed server-side from the shot seed (so they're
 * stable on replay) and passed in here; we just turn them into glanceable cues.
 */
export function puttRead(
  bucket: Exclude<PuttBucket, "tap">,
  distanceFt: number,
  breakDir: BreakDir,
  slope: Slope,
  speed: GreenSpeed
): { cues: Cue[] } {
  const cues: Cue[] = [];
  cues.push(
    bucket === "short"
      ? { icon: "🎯", text: `Birdie look · ~${distanceFt} ft` }
      : { icon: "📏", text: `Long putt · ~${distanceFt} ft` }
  );

  const slick = speed === "Fast" || speed === "Firm";
  if (slope === "downhill") cues.push({ icon: "⏬", text: slick ? "Slick — downhill" : "Downhill" });
  else if (slope === "uphill") cues.push({ icon: "⏫", text: "Uphill — firm it" });
  else if (slick) cues.push({ icon: "⚡", text: "Quick green" });

  if (breakDir === "L") cues.push({ icon: "↩️", text: "Breaks right-to-left" });
  else if (breakDir === "R") cues.push({ icon: "↪️", text: "Breaks left-to-right" });
  else cues.push({ icon: "➡️", text: "Dead straight" });

  return { cues: cues.slice(0, 3) };
}

/** Risk read for a PUTT decision (Lag / Roll it / Charge). Charging a long,
 * slick putt is where three-jacks live; lag protects the card. */
export function puttRiskRead(
  decision: Decision,
  bucket: Exclude<PuttBucket, "tap">,
  speed: GreenSpeed
): { tone: Tone; text: string } {
  const slick = speed === "Fast" || speed === "Firm";
  if (decision === "safe") return { tone: "good", text: "Lag it close" };
  if (decision === "normal") return { tone: "good", text: "Good speed" };
  // aggressive — Charge
  if (bucket === "short") return { tone: slick ? "warn" : "good", text: slick ? "Risky pace" : "Make it" };
  return { tone: "bad", text: "Three-jack risk" };
}

/** Risk read for a SHORT-GAME decision (Punch / Chip / Flop) from off the green. */
export function shortGameRiskRead(decision: Decision): { tone: Tone; text: string } {
  if (decision === "safe") return { tone: "good", text: "Safe — take bogey" };
  if (decision === "normal") return { tone: "good", text: "Get it close" };
  return { tone: "warn", text: "Go for the save" };
}

/** Headline for the green position (used in the putt/scramble banner). */
export function greenRead(green: GreenResult): { tone: Tone; text: string } {
  switch (green) {
    case "kickin":
      return { tone: "good", text: "Kick-in — gimme" };
    case "makeable":
      return { tone: "good", text: "Birdie look" };
    case "lag":
      return { tone: "warn", text: "Long two-putt territory" };
    case "scramble":
      return { tone: "bad", text: "Missed green — get up & down" };
  }
}

/**
 * Contextual nudge based on where the player stands. Keeps the binary goal
 * (break par) front-of-mind so decisions become state-dependent risk
 * management rather than a fixed per-hole policy. Informative, not prescriptive.
 */
export function situationRead(rel: number, holesLeft: number): { tone: Tone; text: string } | null {
  const underPar = rel < 0;
  if (holesLeft <= 6) {
    if (underPar) return { tone: "good", text: "Under par — protect the card" };
    if (rel === 0) return { tone: "warn", text: "Need one birdie to break par" };
    return { tone: "bad", text: `${rel} over — time to make a move` };
  }
  if (holesLeft <= 12 && rel >= 2) return { tone: "warn", text: "Behind pace — look for chances" };
  return null;
}
