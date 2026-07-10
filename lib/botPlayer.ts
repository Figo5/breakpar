import { courseBySlug } from "@/data/courses";
import { holeDifficulty, type HoleSpec, type Conditions } from "@/lib/engine/resolveHole";
import { resolveHoleChain, type ChainResult, type Lie } from "@/lib/engine/shots";
import type { Decision, Outcome } from "@/lib/engine/probabilities";
import type { GreenSpeed } from "@/lib/engine/putting";
import { holeShotSeed, eventSeed } from "@/lib/engine/rng";
import { AGGRESSIVE_BUDGET } from "@/lib/holeRead";

/**
 * BOT OPPONENTS for challenge mode — and, quietly, the AI-field mechanism
 * career mode will reuse.
 *
 * A bot is a DECISION POLICY, not a model: it plays the same engine chain as a
 * human, on the SAME challenge seedKey, through the same per-shot seeds
 * (`holeShotSeed(seedKey, hole, shot)`). So the bot faces byte-identical hole
 * conditions to the human it's playing — same fairness guarantee as
 * human-vs-human challenges.
 *
 * Because the chain is deterministic given (SERVER_SEED, seedKey, hole, shot)
 * and the policies are pure functions of game state, a bot's entire round is
 * DETERMINISTIC and can be recomputed identically at any time. Nothing about
 * its play needs to be stored — reveal pacing is purely a read-time concern.
 *
 * Policies are ports of the calibration harness players (scripts/calibrate.ts),
 * which is what makes their scoring characteristics known quantities.
 */

interface BotState {
  rel: number;
  holesLeft: number;
  aggrLeft: number;
}

interface BotPolicy {
  tee: (h: HoleSpec, d: number, st: BotState) => Decision;
  approach: (h: HoleSpec, d: number, lie: Lie | null, st: BotState) => Decision;
  putt: (h: HoleSpec, bucket: "short" | "long", st: BotState) => Decision;
  scramble: (h: HoleSpec, st: BotState) => Decision;
}

export interface BotProfile {
  /** Display username for the bot's User row (usernames are NOT unique). */
  username: string;
  displayName: string;
  blurb: string;
  policy: BotPolicy;
}

/**
 * The roster. Usernames are reserved: they identify a User row as a bot with
 * no schema change. Keyed by the public bot key used in the API.
 */
export const BOTS: Record<string, BotProfile> = {
  rusty: {
    username: "rusty-the-bot",
    displayName: "Rusty",
    blurb: "Plays everything down the middle. Beatable — usually.",
    policy: {
      tee: () => "normal",
      approach: () => "normal",
      putt: () => "normal",
      scramble: () => "normal",
    },
  },
  scratch: {
    username: "scratch-the-bot",
    displayName: "Scratch",
    blurb: "Picks the right spots. Attacks good lies, respects hard holes.",
    policy: {
      tee: (_h, d, st) => (st.aggrLeft > 0 && d < 0.34 ? "aggressive" : d > 0.62 ? "safe" : "normal"),
      approach: (h, _d, lie, st) => {
        if (lie === "trouble") return "safe";
        if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway")) return "aggressive";
        return st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") ? "aggressive" : "normal";
      },
      putt: (_h, bucket) => (bucket === "short" ? "normal" : "safe"),
      scramble: () => "normal",
    },
  },
  ace: {
    username: "ace-the-bot",
    displayName: "Ace",
    blurb: "Reads the round like a tour pro. Charges when behind, protects a lead.",
    policy: {
      tee: (h, d, st) => {
        const behind = st.rel >= 0;
        let attackBelow = 0.32;
        if (behind && st.holesLeft <= 9) attackBelow = 0.46;
        if (behind && st.holesLeft <= 4) attackBelow = 0.62;
        if (st.rel <= -2 && st.holesLeft <= 6) attackBelow = 0.18;
        if (st.aggrLeft > 0 && d < attackBelow) return "aggressive";
        return d > 0.6 && !(behind && st.holesLeft <= 4) ? "safe" : "normal";
      },
      approach: (h, d, lie, st) => {
        if (lie === "trouble") return st.rel >= 1 && st.holesLeft <= 3 && st.aggrLeft > 0 ? "aggressive" : "safe";
        if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") && d < 0.55) return "aggressive";
        if (lie === "rough") return st.aggrLeft > 0 && st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
        return st.aggrLeft > 0 && d < 0.5 ? "aggressive" : "normal";
      },
      putt: (_h, bucket, st) => {
        if (bucket === "short") return st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
        return st.rel >= 2 && st.holesLeft <= 3 ? "normal" : "safe";
      },
      scramble: (_h, st) => (st.rel >= 1 && st.holesLeft <= 6 ? "aggressive" : "normal"),
    },
  },
};

/**
 * Bots are identified by a RESERVED guestId, never by username. `username` is
 * not unique in the schema (guests share display patterns), so a player could
 * name themselves "ace-the-bot" — but guestId IS unique, and real guest ids are
 * generated cuids that can never start with "bot:".
 */
export function botGuestId(botKey: string): string {
  return `bot:${botKey}`;
}

export function botKeyFromGuestId(guestId: string | null | undefined): string | null {
  if (!guestId || !guestId.startsWith("bot:")) return null;
  const key = guestId.slice(4);
  return key in BOTS ? key : null;
}

export function botByUsername(username: string): (BotProfile & { key: string }) | null {
  for (const [key, b] of Object.entries(BOTS)) {
    if (b.username === username) return { ...b, key };
  }
  return null;
}

export function isBotUsername(username: string): boolean {
  return botByUsername(username) !== null;
}

export interface BotHoleResult {
  holeNumber: number;
  par: number;
  scoreChange: number; // relative to par on this hole
  outcome: string;
  decisions: string; // comma-joined chain, same format the live route stores
}

export interface BotRound {
  holes: BotHoleResult[];
  score: number; // total strokes
  relativeToPar: number;
}

/** Spend a budget token only on tee/approach aggressive plays. */
function spend(decision: Decision, st: BotState): Decision {
  if (decision !== "aggressive") return decision;
  if (st.aggrLeft <= 0) return "normal";
  st.aggrLeft--;
  return "aggressive";
}

/**
 * Simulate the bot's full round for a challenge, on the challenge's seedKey.
 *
 * IMPORTANT: seeds are namespaced per player, not shared verbatim. Using the
 * raw seedKey would make the bot's dice IDENTICAL to the human's (the human
 * could learn the round's outcomes by watching the bot). The bot plays the
 * same COURSE under the same conditions, but on its own salted stream —
 * mirroring how two humans in a challenge share hole conditions but the
 * outcome stream differs by their own decisions.
 */
export function simulateBotRound(seedKey: string, courseSlug: string, botKey: string): BotRound | null {
  const bot = BOTS[botKey];
  const course = courseBySlug(courseSlug);
  if (!bot || !course) return null;

  const botSeedRef = `${seedKey}:bot:${botKey}`;
  const cond: Conditions = { difficulty: course.difficulty, wind: course.wind };
  const st: BotState = { rel: 0, holesLeft: course.holes.length, aggrLeft: AGGRESSIVE_BUDGET };
  const recent: Outcome[] = [];
  const holes: BotHoleResult[] = [];
  let total = 0;

  for (let hi = 0; hi < course.holes.length; hi++) {
    const h = course.holes[hi];
    const spec: HoleSpec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
    const d = holeDifficulty(spec, cond);
    st.holesLeft = course.holes.length - hi;

    const opts = {
      shotSeed: (s: number) => holeShotSeed(botSeedRef, h.number, s),
      eventSeed: (s: number) => eventSeed(botSeedRef, h.number, s),
      greens: course.greens as GreenSpeed,
      recent,
      narration: false as const,
    };

    const decisions: Decision[] = [];
    let res: ChainResult = resolveHoleChain(decisions, spec, cond, opts);
    let guard = 0;
    while (!res.complete && guard++ < 6) {
      let dec: Decision;
      if (res.next === "tee") dec = spend(bot.policy.tee(spec, d, st), st);
      else if (res.next === "approach") dec = spend(bot.policy.approach(spec, d, res.lie ?? null, st), st);
      else if (res.next === "putt") dec = bot.policy.putt(spec, res.putt!.bucket, st);
      else dec = bot.policy.scramble(spec, st);
      decisions.push(dec);
      res = resolveHoleChain(decisions, spec, cond, opts);
    }

    const scoreChange = res.scoreDelta ?? 0;
    total += h.par + scoreChange;
    st.rel += scoreChange;
    recent.push(res.outcome as Outcome);
    holes.push({
      holeNumber: h.number,
      par: h.par,
      scoreChange,
      outcome: String(res.outcome),
      decisions: decisions.slice(0, res.used ?? decisions.length).join(","),
    });
  }

  return { holes, score: total, relativeToPar: total - coursePar(course.holes) };
}

function coursePar(holes: { par: number }[]): number {
  return holes.reduce((s, h) => s + h.par, 0);
}

/**
 * Reveal pacing: the slice of the bot's round a player is allowed to see, given
 * how many holes THEY have completed. You see the bot's hole N when you finish
 * your hole N — it feels like playing alongside, with zero real-time plumbing.
 * When the human's round is complete, everything is visible.
 */
export function revealBotHoles(round: BotRound, humanHolesCompleted: number): BotHoleResult[] {
  const n = Math.max(0, Math.min(round.holes.length, humanHolesCompleted));
  return round.holes.slice(0, n);
}
