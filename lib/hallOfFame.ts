/**
 * Hall of Fame — a player's BEST card on every course (Stage A).
 *
 * Derived entirely from completed `Round` rows (daily + unlimited), so there's
 * no separate table to drift out of sync: your record on a course is simply the
 * lowest relative-to-par round you've ever posted there, fastest as tiebreak.
 * Read-only — never provisions a user, so visiting the page can't spawn an
 * account. Because guest history lives on a durable `User` row that sign-in
 * ADOPTS (see lib/user.ts), a guest's Hall of Fame carries over on sign-up for
 * free — no extra plumbing.
 *
 * Anti-cheat: scores are server-resolved (see the /hole route), never client
 * submitted, so reading best-ever straight off Round is trustworthy.
 *
 * The pure helpers (`bestByCourse`, `buildRecords`) take plain rows so they're
 * trivially unit-testable; only `getHallOfFame` touches the DB.
 */

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { NON_CHALLENGE } from "@/lib/challenge";
import { puzzleNumberForKey } from "@/lib/daily";
import { COURSES, coursePar, courseBySlug } from "@/data/courses";

/** Minimal round shape the derivation needs. */
export interface RoundLite {
  id: string;
  courseSlug: string;
  mode: string;
  dateKey: string | null;
  score: number;
  relativeToPar: number;
  durationMs: number | null;
  playedAt: Date;
}

/** One course's slot in the Hall of Fame — your best card, or an open slot. */
export interface CourseRecord {
  slug: string;
  courseName: string;
  location: string;
  par: number;
  played: boolean;
  // populated only when played:
  roundId: string | null;
  relativeToPar: number | null;
  score: number | null;
  mode: "daily" | "unlimited" | null;
  puzzleNo: number | null;
  achievedAt: string | null; // ISO
}

export interface HallOfFame {
  username: string;
  signedIn: boolean;
  coursesTotal: number;
  coursesPlayed: number; // distinct courses with a completed round
  recordsUnderPar: number; // course records that broke par
  bestOverall: number | null; // best relative-to-par across all records
  records: CourseRecord[]; // one per catalogue course: conquered first, then open slots
}

/** Duration as a comparable number (null sorts last). */
const dur = (r: RoundLite) => r.durationMs ?? Number.POSITIVE_INFINITY;

/**
 * Reduce a flat list of completed rounds to the single BEST round per course
 * slug: lowest relative-to-par wins, fastest breaks the tie. Pure.
 */
export function bestByCourse(rows: RoundLite[]): Map<string, RoundLite> {
  const best = new Map<string, RoundLite>();
  for (const r of rows) {
    const cur = best.get(r.courseSlug);
    if (
      !cur ||
      r.relativeToPar < cur.relativeToPar ||
      (r.relativeToPar === cur.relativeToPar && dur(r) < dur(cur))
    ) {
      best.set(r.courseSlug, r);
    }
  }
  return best;
}

/**
 * Build the per-course record list across the WHOLE catalogue: every course
 * gets a slot so unplayed courses render as open slots (a completion goal).
 * Conquered courses come first, best-to-par ascending (your finest cards on
 * top); unplayed courses follow in catalogue order. Pure.
 */
export function buildRecords(best: Map<string, RoundLite>): CourseRecord[] {
  const records: CourseRecord[] = COURSES.map((c) => {
    const r = best.get(c.slug);
    const base = {
      slug: c.slug,
      courseName: c.name.split("—")[0].trim(),
      location: c.location,
      par: coursePar(c),
    };
    if (!r) {
      return {
        ...base,
        played: false,
        roundId: null,
        relativeToPar: null,
        score: null,
        mode: null,
        puzzleNo: null,
        achievedAt: null,
      };
    }
    return {
      ...base,
      played: true,
      roundId: r.id,
      relativeToPar: r.relativeToPar,
      score: r.score,
      mode: r.mode === "daily" ? "daily" : "unlimited",
      puzzleNo: r.dateKey ? puzzleNumberForKey(r.dateKey) : null,
      achievedAt: r.playedAt.toISOString(),
    };
  });

  return records.sort((a, b) => {
    if (a.played !== b.played) return a.played ? -1 : 1; // conquered first
    if (a.played && b.played) return a.relativeToPar! - b.relativeToPar!; // best on top
    return 0; // unplayed keep catalogue order (stable sort)
  });
}

export async function getHallOfFame(): Promise<HallOfFame | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  // One user's own completed rounds — reduced to best-per-course in JS. Keeps
  // the query simple and the winning round's metadata (id/mode/date/time) in
  // hand without a second fetch. Index @@index([userId, mode]) already exists.
  const rows = await prisma.round.findMany({
    // Challenge rounds are excluded from the Hall of Fame (shared-seed head-to-
    // head must not farm course records). See lib/challenge NON_CHALLENGE.
    where: { userId: user.id, completed: true, ...NON_CHALLENGE },
    select: {
      id: true,
      mode: true,
      dateKey: true,
      score: true,
      relativeToPar: true,
      durationMs: true,
      playedAt: true,
      course: { select: { slug: true } },
    },
  });

  // Drop any round whose course is no longer in the catalogue (defensive).
  const lite: RoundLite[] = rows
    .filter((r) => courseBySlug(r.course.slug))
    .map((r) => ({
      id: r.id,
      courseSlug: r.course.slug,
      mode: r.mode,
      dateKey: r.dateKey,
      score: r.score,
      relativeToPar: r.relativeToPar,
      durationMs: r.durationMs,
      playedAt: r.playedAt,
    }));

  const best = bestByCourse(lite);
  const records = buildRecords(best);
  const conquered = records.filter((r) => r.played);

  return {
    username: user.username,
    signedIn: !!user.clerkId,
    coursesTotal: COURSES.length,
    coursesPlayed: conquered.length,
    recordsUnderPar: conquered.filter((r) => r.relativeToPar! < 0).length,
    bestOverall: conquered.length ? Math.min(...conquered.map((r) => r.relativeToPar!)) : null,
    records,
  };
}
