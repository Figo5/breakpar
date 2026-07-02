/**
 * Post-hole ODDS REVEAL — the "your decision mattered" teaching layer.
 *
 * The live game deliberately hides exact odds (see holeRead.ts) so play stays
 * about READING cues, not solving EV. But a recurring player complaint is that
 * outcomes "feel like RNG regardless of the decision." They're not — the engine
 * has a real skill gap — the odds are just invisible in the moment.
 *
 * This module surfaces, AFTER a hole is decided, the tee-shot odds the player
 * actually faced for the choice they made vs. the safe alternative. It reuses
 * the SAME exported weight tables the engine resolves from (teeWeights), so the
 * reveal can never drift from the real probabilities. It's display-only: it
 * never draws RNG, never touches scoring/calibration.
 *
 * Design guardrail: this is a POST-decision reveal (learning), not a live
 * pre-decision readout (which would turn the game into solved arithmetic).
 */

import { teeWeights, type Lie } from "@/lib/engine/shots";
import type { Decision } from "@/lib/engine/probabilities";
import type { HoleSpec, Conditions } from "@/lib/engine/resolveHole";

export interface OddsRow {
  decision: Decision;
  label: string;
  /** Normalized lie percentages (sum to 100), rounded to whole numbers. */
  pct: Record<Lie, number>;
  /** "Good" outcome share = dialed + fairway (found the short grass). */
  goodPct: number;
  /** "Trouble" share = trouble lie (the blow-up seed). */
  troublePct: number;
}

const DECISION_LABEL: Record<Decision, string> = {
  safe: "Safe",
  normal: "Normal",
  aggressive: "Aggressive",
};

/** Normalize a raw weight map to whole-number percentages summing to 100. */
function toPct(w: Record<Lie, number>): Record<Lie, number> {
  const lies: Lie[] = ["dialed", "fairway", "rough", "trouble"];
  const total = lies.reduce((a, k) => a + w[k], 0) || 1;
  const raw = lies.map((k) => ({ k, v: (w[k] / total) * 100 }));
  // Round to integers, then fix the rounding drift on the largest bucket so the
  // displayed numbers always sum to exactly 100.
  const rounded = raw.map((r) => ({ k: r.k, v: Math.round(r.v) }));
  const drift = 100 - rounded.reduce((a, r) => a + r.v, 0);
  if (drift !== 0) {
    const biggest = rounded.reduce((a, b) => (b.v > a.v ? b : a));
    biggest.v += drift;
  }
  const out = {} as Record<Lie, number>;
  for (const r of rounded) out[r.k] = r.v;
  return out;
}

function rowFor(decision: Decision, hole: HoleSpec, c: Conditions): OddsRow {
  const pct = toPct(teeWeights(decision, hole, c));
  return {
    decision,
    label: DECISION_LABEL[decision],
    pct,
    goodPct: pct.dialed + pct.fairway,
    troublePct: pct.trouble,
  };
}

/**
 * The tee-shot odds the player faced, for the decision they made plus the two
 * alternatives — so the reveal shows how the choice moved the numbers.
 * `chosen` is highlighted by the caller. Par 3s have no tee decision (the first
 * decision is the tee shot at the green), so callers should only invoke this
 * for par 4/5 tee decisions; returns all three decisions' odds either way.
 */
export function teeOddsReveal(
  hole: HoleSpec,
  c: Conditions
): { safe: OddsRow; normal: OddsRow; aggressive: OddsRow } {
  return {
    safe: rowFor("safe", hole, c),
    normal: rowFor("normal", hole, c),
    aggressive: rowFor("aggressive", hole, c),
  };
}

/**
 * A one-line, plain-English takeaway comparing the chosen decision to Safe —
 * the "your call mattered" sentence. Frames variance honestly: a good lie isn't
 * a good score guarantee, and a safe play lowers risk without eliminating it.
 */
export function teeOddsTakeaway(chosen: Decision, hole: HoleSpec, c: Conditions): string {
  const rows = teeOddsReveal(hole, c);
  const mine = rows[chosen];
  if (chosen === "safe") {
    return `Safe gave you the best odds of finding short grass (${mine.goodPct}%) and the lowest trouble risk (${mine.troublePct}%) — but golf still has variance, so a bogey is always on the table.`;
  }
  const safe = rows.safe;
  const goodDelta = mine.goodPct - safe.goodPct;
  const troubleDelta = mine.troublePct - safe.troublePct;
  const goodPhrase =
    goodDelta >= 0
      ? `a slightly better shot at a great position (${mine.goodPct}% vs ${safe.goodPct}% safe)`
      : `a lower chance of the short grass (${mine.goodPct}% vs ${safe.goodPct}% safe)`;
  return `Going ${DECISION_LABEL[chosen].toLowerCase()} traded ${goodPhrase} for more trouble risk (${mine.troublePct}% vs ${safe.troublePct}% safe). Your decision shifted the odds — the outcome was one roll inside them.`;
}
