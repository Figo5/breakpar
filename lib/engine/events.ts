/**
 * In-round EVENTS — seeded texture, fired sparingly.
 *
 * On a minority of shots a small event fires, nudges the relevant weight table,
 * and emits a one-line narration ("A gust knocks it down…"). Everything is
 * derived from eventSeed(roundId, hole, shotIndex), so events — like outcomes —
 * are reproducible on replay and never client-side.
 *
 * Keep it texture, not a slot machine: fire-rate and magnitudes are modest and
 * all live in this file. Events shift the odds you were already facing; they
 * don't invent free strokes.
 */

import { mulberry32 } from "./rng";
import type { Lie } from "./shots";
import type { GreenResult, PuttResult, ScrambleResult } from "./putting";
import type { Outcome } from "./probabilities";

/** Which resolution an event can attach to. */
export type EventStage = "tee" | "approach" | "putt" | "scramble";

export interface EventInstance {
  id: string;
  label: string;
  narration: string;
  tone: "good" | "even" | "bad";
}

/** Share of shots that draw a (non-momentum) event. Kept modest. */
export const EVENT_FIRE_RATE = 0.2;

interface EventDef {
  id: string;
  label: string;
  narration: string;
  tone: "good" | "even" | "bad";
  stages: EventStage[];
  weight: number; // relative selection weight within an eligible stage
  // Optional per-stage weight mutators. Each receives the live weight record
  // for that stage and mutates it in place.
  tee?: (w: Record<Lie, number>) => void;
  green?: (w: Record<GreenResult, number>) => void;
  putt?: (w: Record<PuttResult, number>) => void;
  scramble?: (w: Record<ScrambleResult, number>) => void;
}

/** Starter event set. Magnitudes are deliberately gentle. */
const EVENTS: EventDef[] = [
  {
    id: "GUST",
    label: "Gust",
    narration: "A gust rips across the hole — this just got harder.",
    tone: "bad",
    stages: ["tee", "approach"],
    weight: 3,
    tee: (w) => {
      w.dialed *= 0.6;
      w.fairway *= 0.85;
      w.rough *= 1.25;
      w.trouble *= 1.4;
    },
    green: (w) => {
      w.kickin *= 0.6;
      w.makeable *= 0.85;
      w.lag *= 1.2;
      w.scramble *= 1.35;
    },
  },
  {
    id: "GOOD_KICK",
    label: "Good kick",
    narration: "A friendly kick funnels it back into play. 🍀",
    tone: "good",
    stages: ["tee", "approach"],
    weight: 2.5,
    tee: (w) => {
      w.dialed *= 1.4;
      w.fairway *= 1.2;
      w.rough *= 0.8;
      w.trouble *= 0.5;
    },
    green: (w) => {
      w.kickin *= 1.4;
      w.makeable *= 1.2;
      w.lag *= 0.85;
      w.scramble *= 0.6;
    },
  },
  {
    id: "BAD_BOUNCE",
    label: "Bad bounce",
    narration: "Took an awful bounce off the slope. 😖",
    tone: "bad",
    stages: ["tee", "approach"],
    weight: 2.5,
    tee: (w) => {
      w.dialed *= 0.55;
      w.fairway *= 0.8;
      w.rough *= 1.3;
      w.trouble *= 1.4;
    },
    green: (w) => {
      w.kickin *= 0.55;
      w.makeable *= 0.8;
      w.lag *= 1.25;
      w.scramble *= 1.3;
    },
  },
  {
    id: "TUCKED_PIN",
    label: "Tucked pin",
    narration: "Sucker pin, tucked behind the bunker — birdie looks are scarce.",
    tone: "even",
    stages: ["approach"],
    weight: 2.5,
    green: (w) => {
      w.kickin *= 0.6;
      w.makeable *= 0.55;
      w.lag *= 1.4;
      w.scramble *= 1.2;
    },
  },
  {
    id: "PURE_GREENS",
    label: "Pure greens",
    narration: "The greens are running pure — putts are dropping today.",
    tone: "good",
    stages: ["putt"],
    weight: 3,
    putt: (w) => {
      w.oneputt *= 1.5;
      w.threeputt *= 0.6;
    },
  },
  {
    id: "DOWNHILL_SLIDER",
    label: "Downhill slider",
    narration: "Slick downhill slider — easy to run it by.",
    tone: "bad",
    stages: ["putt"],
    weight: 2.5,
    putt: (w) => {
      w.oneputt *= 1.15;
      w.threeputt *= 1.8;
    },
  },
];

const MOMENTUM_UP: EventDef = {
  id: "MOMENTUM_UP",
  label: "In the zone",
  narration: "Back-to-back birdies — you're in the zone. 🔥",
  tone: "good",
  stages: ["tee", "approach"],
  weight: 0,
  tee: (w) => {
    w.dialed *= 1.2;
    w.fairway *= 1.08;
    w.trouble *= 0.8;
  },
  green: (w) => {
    w.kickin *= 1.2;
    w.makeable *= 1.08;
    w.scramble *= 0.85;
  },
};

const MOMENTUM_DOWN: EventDef = {
  id: "MOMENTUM_DOWN",
  label: "Rattled",
  narration: "Still stinging from that blow-up — shake it off.",
  tone: "bad",
  stages: ["tee", "approach"],
  weight: 0,
  tee: (w) => {
    w.dialed *= 0.85;
    w.rough *= 1.12;
    w.trouble *= 1.15;
  },
  green: (w) => {
    w.kickin *= 0.85;
    w.makeable *= 0.92;
    w.scramble *= 1.15;
  },
};

const instanceOf = (e: EventDef): EventInstance => ({
  id: e.id,
  label: e.label,
  narration: e.narration,
  tone: e.tone,
});

function pickWeighted(defs: EventDef[], rng: () => number): EventDef {
  const total = defs.reduce((a, e) => a + e.weight, 0);
  let r = rng() * total;
  for (const e of defs) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return defs[defs.length - 1];
}

/**
 * Momentum is DETERMINISTIC from the round so far (no dice): two birdie-or-
 * better in a row gives a small boost; a recent double-or-worse a small wobble.
 * Returned only at the first shot of a hole; null otherwise.
 */
export function momentumFor(recent: Outcome[]): EventDef | null {
  if (recent.length === 0) return null;
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  const isBirdieish = (o?: Outcome) => o === "birdie" || o === "eagle";
  if (isBirdieish(last) && isBirdieish(prev)) return MOMENTUM_UP;
  if (last === "double" || last === "triple") return MOMENTUM_DOWN;
  return null;
}

export interface EventContext {
  recent?: Outcome[]; // outcomes of prior holes this round (for momentum)
  firstShotOfHole?: boolean; // momentum only fires on the first shot
}

/**
 * Resolve the event (if any) for one shot. `seed` comes from eventSeed(...).
 * Returns both the chosen def (so the resolver can apply its weight mods) and a
 * lightweight instance (for the UI / transcript). Deterministic.
 */
export function rollEvent(
  stage: EventStage,
  seed: number,
  ctx: EventContext = {}
): { def: EventDef; instance: EventInstance } | null {
  // Momentum takes precedence on the opening shot of a hole.
  if (ctx.firstShotOfHole && (stage === "tee" || stage === "approach")) {
    const mo = momentumFor(ctx.recent ?? []);
    if (mo) return { def: mo, instance: instanceOf(mo) };
  }

  const rng = mulberry32(seed);
  if (rng() >= EVENT_FIRE_RATE) return null;

  const eligible = EVENTS.filter((e) => e.stages.includes(stage));
  if (eligible.length === 0) return null;
  const def = pickWeighted(eligible, rng);
  return { def, instance: instanceOf(def) };
}

/** Apply an event's weight mods to the live distribution for a stage. */
export function applyEvent(
  def: EventDef,
  stage: EventStage,
  weights: Record<string, number>
): void {
  if (stage === "tee" && def.tee) def.tee(weights as Record<Lie, number>);
  else if (stage === "approach" && def.green) def.green(weights as Record<GreenResult, number>);
  else if (stage === "putt" && def.putt) def.putt(weights as Record<PuttResult, number>);
  else if (stage === "scramble" && def.scramble) def.scramble(weights as Record<ScrambleResult, number>);
}

export { EVENTS };
