/**
 * Profile aggregates for the signed-in (or guest) player: lifetime stats, their
 * personal best-rounds leaderboard, and recent games. Read-only — never creates
 * a user, so visiting the page can't provision an account.
 */

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { isStreakAlive } from "@/lib/scoring";
import { dateKey, previousKey, puzzleNumberForKey } from "@/lib/daily";
import { coursePar, courseBySlug } from "@/data/courses";

export interface ProfileRound {
  id: string;
  rank: number;
  courseName: string;
  par: number;
  mode: "daily" | "unlimited";
  puzzleNo: number | null;
  score: number; // total strokes
  relativeToPar: number;
  durationMs: number | null;
  playedAt: string; // ISO
}

export interface ProfileData {
  username: string;
  imageUrl: string | null;
  signedIn: boolean;
  profilePublic: boolean;
  roundsPlayed: number;
  bestToPar: number | null;
  underParRounds: number;
  dayStreak: number; // effective current streak (0 if broken)
  bestStreak: number;
  bestRounds: ProfileRound[]; // top rounds by score (the personal leaderboard)
  recentRounds: ProfileRound[]; // most recent completed rounds
}

/** Resolve a stored round into the display shape, using its own course. */
function shape(
  r: {
    id: string;
    mode: string;
    dateKey: string | null;
    score: number;
    relativeToPar: number;
    durationMs: number | null;
    playedAt: Date;
    course: { slug: string };
  },
  rank: number
): ProfileRound | null {
  const course = courseBySlug(r.course.slug);
  if (!course) return null;
  return {
    id: r.id,
    rank,
    courseName: course.name.split("—")[0].trim(),
    par: coursePar(course),
    mode: r.mode === "daily" ? "daily" : "unlimited",
    puzzleNo: r.dateKey ? puzzleNumberForKey(r.dateKey) : null,
    score: r.score,
    relativeToPar: r.relativeToPar,
    durationMs: r.durationMs,
    playedAt: r.playedAt.toISOString(),
  };
}

export async function getProfile(): Promise<ProfileData | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const select = {
    id: true,
    mode: true,
    dateKey: true,
    score: true,
    relativeToPar: true,
    durationMs: true,
    playedAt: true,
    course: { select: { slug: true } },
  } as const;

  const [roundsPlayed, underParRounds, streak, bestRows, recentRows] = await Promise.all([
    prisma.round.count({ where: { userId: user.id, completed: true } }),
    prisma.round.count({ where: { userId: user.id, completed: true, relativeToPar: { lt: 0 } } }),
    prisma.streak.findUnique({ where: { userId: user.id } }),
    // Personal leaderboard: best (lowest) relative-to-par, fastest as tiebreak.
    prisma.round.findMany({
      where: { userId: user.id, completed: true },
      orderBy: [{ relativeToPar: "asc" }, { durationMs: "asc" }],
      take: 10,
      select,
    }),
    prisma.round.findMany({
      where: { userId: user.id, completed: true },
      orderBy: { playedAt: "desc" },
      take: 8,
      select,
    }),
  ]);

  const today = dateKey();
  const yesterday = previousKey(today); // civil yesterday (DST-safe)
  const graceKey = previousKey(yesterday); // one-day freeze bridge
  const alive =
    !!streak && isStreakAlive(streak.currentStreak, streak.lastPlayedKey, today, yesterday, graceKey);

  const bestRounds = bestRows
    .map((r, i) => shape(r, i + 1))
    .filter((r): r is ProfileRound => r !== null);
  const recentRounds = recentRows
    .map((r, i) => shape(r, i + 1))
    .filter((r): r is ProfileRound => r !== null);

  return {
    username: user.username,
    imageUrl: user.imageUrl,
    signedIn: !!user.clerkId,
    profilePublic: user.profilePublic,
    roundsPlayed,
    bestToPar: bestRounds.length ? bestRounds[0].relativeToPar : null,
    underParRounds,
    dayStreak: alive ? streak!.currentStreak : 0,
    bestStreak: streak?.maxStreak ?? 0,
    bestRounds,
    recentRounds,
  };
}
