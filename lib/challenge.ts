/**
 * Challenges (Stage 2) — shared-seed head-to-head between two accounts.
 *
 * Both players play the SAME course from a shared `seedKey` (= the challenge id),
 * so identical decisions face identical hole conditions and skill is what differs
 * (see app/api/round/[id]/hole: it seeds from `round.seedKey ?? round.id`).
 * Async: each plays on their own time; the challenge settles when both rounds
 * complete, and the lower to-par wins.
 *
 * Challenge rounds are a SEPARATE mode (mode="challenge", dateKey=null): outside
 * the daily rotation, streak, leaderboard, trophies and Hall of Fame — a chosen
 * seed must not be able to farm records. The exclusion is enforced by the
 * NON_CHALLENGE where-guard applied to every stats aggregation query.
 *
 * Accounts only: all mutations are gated to authenticated accounts (clerkId).
 */

import { prisma } from "@/lib/db";
import { resolveAccountByUsername } from "@/lib/friends";
import { courseBySlug, coursePar } from "@/data/courses";
import { dailyCourse } from "@/lib/daily";

/**
 * Prisma where-guard that EXCLUDES challenge rounds from lifetime stats
 * (trophies, HoF course-records, profile totals). No existing rows are
 * "challenge", so applying this is byte-identical for pre-Stage-2 data.
 */
export const NON_CHALLENGE = { mode: { not: "challenge" } } as const;

export type ChallengeStatus = "pending" | "active" | "complete" | "declined" | "expired";

// --- pure helper (unit-tested) ---------------------------------------------

export type Verdict = "win" | "loss" | "draw";

/**
 * Result from `me`'s perspective given both to-par scores (lower is better).
 * Pure. Only meaningful once both rounds are complete.
 */
export function verdict(myRel: number, theirRel: number): Verdict {
  if (myRel < theirRel) return "win";
  if (myRel > theirRel) return "loss";
  return "draw";
}

// --- types -----------------------------------------------------------------

export interface ChallengeSide {
  username: string;
  imageUrl: string | null;
  completed: boolean;
  relativeToPar: number | null; // null until they finish
  roundId: string | null;
}

export interface ChallengeItem {
  id: string;
  status: ChallengeStatus;
  courseName: string;
  par: number;
  iAmChallenger: boolean;
  me: ChallengeSide;
  them: ChallengeSide;
  verdict: Verdict | null; // set when status === "complete"
}

export interface ChallengeGroups {
  yourTurn: ChallengeItem[]; // you haven't finished your round yet (incl. not started)
  waiting: ChallengeItem[]; // you're done, waiting on them
  complete: ChallengeItem[]; // both done, settled
}

// --- shaping ---------------------------------------------------------------

type ChallengeRow = {
  id: string;
  status: string;
  challengerId: string;
  opponentId: string;
  course: { slug: string };
  challenger: { username: string; imageUrl: string | null };
  opponent: { username: string; imageUrl: string | null };
  challengerRound: { id: string; completed: boolean; relativeToPar: number } | null;
  opponentRound: { id: string; completed: boolean; relativeToPar: number } | null;
};

const CHALLENGE_INCLUDE = {
  course: { select: { slug: true } },
  challenger: { select: { username: true, imageUrl: true } },
  opponent: { select: { username: true, imageUrl: true } },
  challengerRound: { select: { id: true, completed: true, relativeToPar: true } },
  opponentRound: { select: { id: true, completed: true, relativeToPar: true } },
} as const;

function side(round: ChallengeRow["challengerRound"], user: { username: string; imageUrl: string | null }): ChallengeSide {
  return {
    username: user.username,
    imageUrl: user.imageUrl,
    completed: !!round?.completed,
    relativeToPar: round?.completed ? round.relativeToPar : null,
    roundId: round?.id ?? null,
  };
}

function toItem(row: ChallengeRow, meId: string): ChallengeItem {
  const iAmChallenger = row.challengerId === meId;
  const me = side(iAmChallenger ? row.challengerRound : row.opponentRound, iAmChallenger ? row.challenger : row.opponent);
  const them = side(iAmChallenger ? row.opponentRound : row.challengerRound, iAmChallenger ? row.opponent : row.challenger);
  const course = courseBySlug(row.course.slug);
  const settled = row.status === "complete" && me.relativeToPar != null && them.relativeToPar != null;
  return {
    id: row.id,
    status: row.status as ChallengeStatus,
    courseName: course ? course.name.split("—")[0].trim() : row.course.slug,
    par: course ? coursePar(course) : 72,
    iAmChallenger,
    me,
    them,
    verdict: settled ? verdict(me.relativeToPar!, them.relativeToPar!) : null,
  };
}

// --- queries ---------------------------------------------------------------

/** All of my challenges (as challenger or opponent), grouped for the UI. */
export async function listChallenges(meId: string): Promise<ChallengeGroups> {
  const rows = (await prisma.challenge.findMany({
    where: { OR: [{ challengerId: meId }, { opponentId: meId }], status: { notIn: ["declined", "expired"] } },
    include: CHALLENGE_INCLUDE,
    orderBy: { createdAt: "desc" },
  })) as unknown as ChallengeRow[];

  const groups: ChallengeGroups = { yourTurn: [], waiting: [], complete: [] };
  for (const row of rows) {
    const item = toItem(row, meId);
    if (item.status === "complete") groups.complete.push(item);
    else if (!item.me.completed) groups.yourTurn.push(item);
    else groups.waiting.push(item);
  }
  return groups;
}

/** A single challenge for the side-by-side detail. Only participants may view
 * it (both consented by playing) — returns null for non-participants/unknown. */
export async function getChallenge(meId: string, id: string): Promise<ChallengeItem | null> {
  const row = (await prisma.challenge.findUnique({ where: { id }, include: CHALLENGE_INCLUDE })) as unknown as ChallengeRow | null;
  if (!row) return null;
  if (row.challengerId !== meId && row.opponentId !== meId) return null;
  return toItem(row, meId);
}

/** Count of challenges awaiting MY move (not started or not finished) — for a nav badge. */
export async function countYourTurn(meId: string): Promise<number> {
  const rows = await prisma.challenge.findMany({
    where: {
      OR: [{ challengerId: meId }, { opponentId: meId }],
      status: { in: ["pending", "active"] },
    },
    select: { challengerId: true, challengerRound: { select: { completed: true } }, opponentRound: { select: { completed: true } } },
  });
  return rows.filter((r) => {
    const mine = r.challengerId === meId ? r.challengerRound : r.opponentRound;
    return !mine?.completed;
  }).length;
}

// --- mutations -------------------------------------------------------------

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: "not-found" | "self" | "unknown-course" | "course-not-seeded" };

/** Create a pending challenge to an account (by username) on a course (default:
 * today's daily course). seedKey = the new challenge's id. */
export async function createChallenge(
  meId: string,
  opponentUsername: string,
  courseSlug?: string
): Promise<CreateResult> {
  const opponent = await resolveAccountByUsername(opponentUsername);
  if (!opponent) return { ok: false, error: "not-found" };
  if (opponent.id === meId) return { ok: false, error: "self" };

  const course = courseSlug ? courseBySlug(courseSlug) : dailyCourse();
  if (!course) return { ok: false, error: "unknown-course" };
  const courseRow = await prisma.course.findUnique({ where: { slug: course.slug }, select: { id: true } });
  if (!courseRow) return { ok: false, error: "course-not-seeded" };

  const ch = await prisma.challenge.create({
    data: { challengerId: meId, opponentId: opponent.id, courseId: courseRow.id, seedKey: "pending" },
    select: { id: true },
  });
  // seedKey = the challenge id (the shared RNG namespace both rounds use).
  await prisma.challenge.update({ where: { id: ch.id }, data: { seedKey: ch.id } });
  return { ok: true, id: ch.id };
}

/** Decline a challenge — opponent-only, while still pending/active and before
 * they've played. A private user can decline without exposing anything. */
export async function declineChallenge(meId: string, id: string): Promise<{ ok: boolean }> {
  const res = await prisma.challenge.updateMany({
    where: { id, opponentId: meId, status: { in: ["pending", "active"] }, opponentRoundId: null },
    data: { status: "declined" },
  });
  return { ok: res.count > 0 };
}

export type StartResult =
  | { ok: true; roundId: string }
  | { ok: false; error: "not-found" | "forbidden" | "unavailable" };

/**
 * Start OR resume MY round for a challenge. One attempt per side: if my side is
 * already linked, resume it; otherwise create a challenge round (mode/seedKey)
 * and link it with a conditional update (the per-side @unique + null-guard makes
 * a double-start safe — the loser drops its orphan and resumes the winner).
 */
export async function startOrResumeChallengeRound(meId: string, challengeId: string): Promise<StartResult> {
  const ch = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!ch) return { ok: false, error: "not-found" };
  const iAmChallenger = ch.challengerId === meId;
  if (!iAmChallenger && ch.opponentId !== meId) return { ok: false, error: "forbidden" };
  if (ch.status === "declined" || ch.status === "expired") return { ok: false, error: "unavailable" };

  const existing = iAmChallenger ? ch.challengerRoundId : ch.opponentRoundId;
  if (existing) return { ok: true, roundId: existing };

  const round = await prisma.round.create({
    data: { userId: meId, courseId: ch.courseId, mode: "challenge", dateKey: null, seedKey: ch.seedKey },
    select: { id: true },
  });
  const linked = await prisma.challenge.updateMany({
    where: { id: challengeId, ...(iAmChallenger ? { challengerRoundId: null } : { opponentRoundId: null }) },
    data: { status: "active", ...(iAmChallenger ? { challengerRoundId: round.id } : { opponentRoundId: round.id }) },
  });
  if (linked.count === 0) {
    // Lost a concurrent first-start race: drop the orphan, resume the winner.
    await prisma.round.delete({ where: { id: round.id } });
    const fresh = await prisma.challenge.findUnique({ where: { id: challengeId } });
    const winner = iAmChallenger ? fresh?.challengerRoundId : fresh?.opponentRoundId;
    if (winner) return { ok: true, roundId: winner };
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, roundId: round.id };
}

/**
 * Settle a challenge when one side's round finishes. Called by the finish route
 * for challenge rounds (after the completion claim). When BOTH rounds are
 * complete, flips status to "complete" + stamps completedAt. Idempotent.
 */
export async function settleChallengeOnFinish(roundId: string): Promise<void> {
  const ch = await prisma.challenge.findFirst({
    where: { OR: [{ challengerRoundId: roundId }, { opponentRoundId: roundId }] },
    include: {
      challengerRound: { select: { completed: true } },
      opponentRound: { select: { completed: true } },
    },
  });
  if (!ch || ch.status === "complete") return;
  if (ch.challengerRound?.completed && ch.opponentRound?.completed) {
    await prisma.challenge.updateMany({
      where: { id: ch.id, status: { not: "complete" } },
      data: { status: "complete", completedAt: new Date() },
    });
  }
}
