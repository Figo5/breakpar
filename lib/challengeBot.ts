import { prisma } from "@/lib/db";
import { courseBySlug } from "@/data/courses";
import { dailyCourse } from "@/lib/daily";
import {
  BOTS,
  botGuestId,
  botKeyFromGuestId,
  simulateBotRound,
  revealBotHoles,
} from "@/lib/botPlayer";

/**
 * BOT CHALLENGES — the same Challenge/Round machinery as human-vs-human, with
 * the opponent side driven by a deterministic policy instead of a person.
 *
 * Shape of the trick:
 *  - A bot exists as a User row with a RESERVED guestId ("bot:{key}") — unique
 *    by schema, unreachable by real guests (their ids are generated cuids). No
 *    migration, and listChallenges / verdict / profile guards all work as-is.
 *  - The bot's Round row is created UP FRONT (incomplete, score 0) and linked
 *    as the opponent side. Its actual play is never "performed": the round is
 *    a pure function of (SERVER_SEED, seedKey, botKey), recomputable at will.
 *  - While the human plays, the live endpoint reveals the bot's holes paced to
 *    the human's progress — playing-alongside feel, zero real-time plumbing.
 *  - When the human finishes, finalizeBotSideIfNeeded materialises the bot's
 *    score + hole results onto its Round row, and normal settlement completes
 *    the challenge.
 *
 * Career-mode note: simulateBotRound + the skill policies ARE the simulated
 * AI field. This feature is that system's first production user.
 */

export type CreateBotResult =
  | { ok: true; id: string }
  | { ok: false; error: "unknown-bot" | "unknown-course" | "course-not-seeded" };

export async function createBotChallenge(
  meId: string,
  botKey: string,
  courseSlug?: string
): Promise<CreateBotResult> {
  const bot = BOTS[botKey];
  if (!bot) return { ok: false, error: "unknown-bot" };

  const course = courseSlug ? courseBySlug(courseSlug) : dailyCourse();
  if (!course) return { ok: false, error: "unknown-course" };
  const courseRow = await prisma.course.findUnique({ where: { slug: course.slug }, select: { id: true } });
  if (!courseRow) return { ok: false, error: "course-not-seeded" };

  // The bot's User row, created on first use. guestId is the identity; username
  // is display-only and safe to refresh.
  const botUser = await prisma.user.upsert({
    where: { guestId: botGuestId(botKey) },
    create: { guestId: botGuestId(botKey), username: bot.username, profilePublic: false },
    update: { username: bot.username },
    select: { id: true },
  });

  // Challenge starts ACTIVE (a bot never has a "pending" inbox), with the bot's
  // placeholder round created and linked in the same transaction. seedKey = the
  // challenge id, same convention as human challenges.
  const ch = await prisma.challenge.create({
    data: {
      challengerId: meId,
      opponentId: botUser.id,
      courseId: courseRow.id,
      seedKey: "pending",
      status: "active",
    },
    select: { id: true },
  });

  const botRound = await prisma.round.create({
    data: { userId: botUser.id, courseId: courseRow.id, mode: "challenge", dateKey: null, seedKey: ch.id },
    select: { id: true },
  });

  await prisma.challenge.update({
    where: { id: ch.id },
    data: { seedKey: ch.id, opponentRoundId: botRound.id },
  });

  return { ok: true, id: ch.id };
}

/**
 * If this challenge's opponent is a bot and its round is still a placeholder,
 * materialise the simulated round (score + per-hole results). Idempotent: the
 * completed flag guards re-entry, and hole results are unique per (round, hole).
 *
 * Called from settleChallengeOnFinish before the both-sides-complete check, so
 * a bot challenge settles the moment the human's round finishes.
 */
export async function finalizeBotSideIfNeeded(challengeId: string): Promise<void> {
  const ch = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: {
      opponent: { select: { guestId: true } },
      opponentRound: { select: { id: true, completed: true } },
      course: { select: { slug: true } },
    },
  });
  if (!ch || !ch.opponentRound || ch.opponentRound.completed) return;

  const botKey = botKeyFromGuestId(ch.opponent.guestId);
  if (!botKey) return; // human opponent — nothing to do

  const sim = simulateBotRound(ch.seedKey, ch.course.slug, botKey);
  if (!sim) return;

  await prisma.$transaction([
    prisma.holeResult.createMany({
      data: sim.holes.map((h) => ({
        roundId: ch.opponentRound!.id,
        holeNumber: h.holeNumber,
        decision: h.decisions,
        outcome: h.outcome,
        scoreChange: h.scoreChange,
      })),
      skipDuplicates: true,
    }),
    prisma.round.update({
      where: { id: ch.opponentRound.id },
      data: {
        score: sim.score,
        relativeToPar: sim.relativeToPar,
        completed: true,
        durationMs: null,
      },
    }),
  ]);
}

// --- live state (the polling payload) --------------------------------------

export interface LiveOpponent {
  name: string;
  isBot: boolean;
  /** Holes visible to the viewer right now. */
  holes: { holeNumber: number; scoreChange: number }[];
  thru: number;
  relativeToPar: number;
  finished: boolean;
}

export interface LiveState {
  challengeId: string;
  status: string;
  me: { thru: number; relativeToPar: number; finished: boolean };
  opponent: LiveOpponent | null;
}

/**
 * The polling payload for a challenge in progress, from the viewer's side.
 *
 * Bot opponents are revealed PACED: you see the bot's hole N once you've
 * completed N holes (all 18 once you're done). Human opponents are shown at
 * their real progress — that's what makes it live.
 */
export async function getLiveState(meId: string, challengeId: string): Promise<LiveState | null> {
  const ch = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: {
      challenger: { select: { id: true, username: true, guestId: true } },
      opponent: { select: { id: true, username: true, guestId: true } },
      challengerRound: { include: { holeResults: { orderBy: { holeNumber: "asc" } } } },
      opponentRound: { include: { holeResults: { orderBy: { holeNumber: "asc" } } } },
      course: { select: { slug: true } },
    },
  });
  if (!ch) return null;

  const iAmChallenger = ch.challengerId === meId;
  if (!iAmChallenger && ch.opponentId !== meId) return null;

  const myRound = iAmChallenger ? ch.challengerRound : ch.opponentRound;
  const theirUser = iAmChallenger ? ch.opponent : ch.challenger;
  const theirRound = iAmChallenger ? ch.opponentRound : ch.challengerRound;

  const myHoles = myRound?.holeResults ?? [];
  const myThru = myHoles.length;
  const myRel = myHoles.reduce((s: number, h: { scoreChange: number }) => s + h.scoreChange, 0);
  const me = { thru: myThru, relativeToPar: myRel, finished: myRound?.completed ?? false };

  const botKey = botKeyFromGuestId(theirUser.guestId);

  let opponent: LiveOpponent | null = null;

  if (botKey) {
    const bot = BOTS[botKey];
    const sim = simulateBotRound(ch.seedKey, ch.course.slug, botKey);
    if (sim) {
      const visible = me.finished ? sim.holes : revealBotHoles(sim, myThru);
      opponent = {
        name: bot.displayName,
        isBot: true,
        holes: visible.map((h) => ({ holeNumber: h.holeNumber, scoreChange: h.scoreChange })),
        thru: visible.length,
        relativeToPar: visible.reduce((s, h) => s + h.scoreChange, 0),
        finished: me.finished,
      };
    }
  } else {
    const holes = theirRound?.holeResults ?? [];
    opponent = {
      name: theirUser.username,
      isBot: false,
      holes: holes.map((h: { holeNumber: number; scoreChange: number }) => ({
        holeNumber: h.holeNumber,
        scoreChange: h.scoreChange,
      })),
      thru: holes.length,
      relativeToPar: holes.reduce((s: number, h: { scoreChange: number }) => s + h.scoreChange, 0),
      finished: theirRound?.completed ?? false,
    };
  }

  return { challengeId: ch.id, status: ch.status, me, opponent };
}
