/**
 * Public profile at /u/[username] — a curated, read-only showcase composed from
 * the SAME derived data as the Hall of Fame / trophy case, just keyed by a
 * resolved account (not the current user). Reuses the pure helpers
 * (bestByCourse/buildRecords, summarizeRounds/evaluateTrophies) so there's no
 * second source of truth.
 *
 * Account-only: guests never get a public profile. Resolution targets the one
 * account (clerkId set) with the username — guaranteed unique by the partial
 * unique index added in the add_public_profiles migration.
 *
 * Privacy: profiles are public by default; a private profile shows only a
 * "private" state to strangers, while the owner always sees their own.
 */

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { NON_CHALLENGE } from "@/lib/challenge";
import { isFollowing } from "@/lib/friends";
import { COURSES } from "@/data/courses";
import { bestByCourse, buildRecords, type RoundLite as HofRound, type CourseRecord } from "@/lib/hallOfFame";
import {
  summarizeRounds,
  buildTrophyBoard,
  TIER_META,
  type RoundLite as TrophyRound,
  type TrophyState,
} from "@/lib/trophies";
import { isStreakAlive } from "@/lib/scoring";
import { dateKey, previousKey, puzzleNumberForKey } from "@/lib/daily";
import { courseBySlug, coursePar } from "@/data/courses";

export interface PublicRound {
  id: string;
  courseName: string;
  par: number;
  mode: "daily" | "unlimited";
  puzzleNo: number | null;
  relativeToPar: number;
  playedAt: string; // ISO
}

export interface PublicProfile {
  username: string;
  xHandle: string | null;
  imageUrl: string | null;
  memberSince: string; // ISO
  isOwner: boolean;
  isPublic: boolean;
  coursesConquered: number;
  coursesTotal: number;
  bestToPar: number | null;
  currentStreak: number;
  bestStreak: number;
  roundsPlayed: number;
  featured: TrophyState[]; // up to 5, earned, ordered (owner's picks or a fallback)
  records: CourseRecord[]; // conquered courses, best first (condensed)
  recent: PublicRound[];
}

/** Viewer's follow relationship to the profile, driving the follow button.
 * Guests get a sign-up CTA; the owner gets no button; otherwise Follow/Following.
 * A private profile is still followable (results stay hidden per the privacy
 * rule) — so this rides on both the private and profile results. */
export interface FollowContext {
  isGuest: boolean; // viewer is not a signed-in account (no clerkId)
  isSelf: boolean; // viewer is the profile owner (no self-follow)
  isFollowing: boolean;
}

export type PublicProfileResult =
  | { kind: "not-found" }
  | { kind: "private"; username: string; follow: FollowContext }
  | { kind: "profile"; profile: PublicProfile; follow: FollowContext };

const CONDENSED_RECORDS = 6;
const RECENT = 8;
const FEATURED_MAX = 5;

/** Pick the featured trophies: the owner's ordered picks (validated earned), or
 * a fallback of the rarest / most-recently-unlocked earned trophies. Pure. */
export function pickFeatured(
  picks: string[],
  earned: TrophyState[],
  max = FEATURED_MAX
): TrophyState[] {
  const byId = new Map(earned.map((t) => [t.id, t]));
  const chosen = picks.map((id) => byId.get(id)).filter((t): t is TrophyState => !!t);
  if (chosen.length) return chosen.slice(0, max);
  // Fallback: rarity desc, then most-recent unlock (known dates first).
  return [...earned]
    .sort(
      (a, b) =>
        TIER_META[b.tier].rank - TIER_META[a.tier].rank ||
        (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? "")
    )
    .slice(0, max);
}

export async function getPublicProfile(username: string): Promise<PublicProfileResult> {
  // Accounts only (clerkId set). The partial unique index guarantees at most one.
  const profileUser = await prisma.user.findFirst({
    where: { username, clerkId: { not: null } },
    select: {
      id: true, username: true, xHandle: true, imageUrl: true, createdAt: true,
      profilePublic: true, featuredTrophies: true,
    },
  });
  if (!profileUser) return { kind: "not-found" };

  const viewer = await getCurrentUser();
  const isOwner = !!viewer && viewer.id === profileUser.id;

  // Follow context for the profile's follow button. Only query the edge when the
  // viewer is an account who isn't the owner (guests/self never follow).
  const viewerIsAccount = !!viewer?.clerkId;
  const follow: FollowContext = {
    isGuest: !viewerIsAccount,
    isSelf: isOwner,
    isFollowing: viewerIsAccount && !isOwner ? await isFollowing(viewer!.id, profileUser.id) : false,
  };

  if (!profileUser.profilePublic && !isOwner)
    return { kind: "private", username: profileUser.username, follow };

  const [rows, streak, awards] = await Promise.all([
    prisma.round.findMany({
      // Exclude challenge rounds from the public profile (records/recent/trophies).
      where: { userId: profileUser.id, completed: true, ...NON_CHALLENGE },
      select: {
        id: true, mode: true, dateKey: true, score: true, relativeToPar: true,
        durationMs: true, playedAt: true, course: { select: { slug: true } },
        holeResults: { select: { outcome: true, scoreChange: true } },
      },
    }),
    prisma.streak.findUnique({ where: { userId: profileUser.id } }),
    prisma.trophyAward.findMany({
      where: { userId: profileUser.id },
      select: { trophyId: true, unlockedAt: true },
    }),
  ]);

  // Course records (reuse the HoF derivation), condensed to conquered courses.
  const hofRounds: HofRound[] = rows
    .filter((r) => courseBySlug(r.course.slug))
    .map((r) => ({
      id: r.id, courseSlug: r.course.slug, mode: r.mode, dateKey: r.dateKey,
      score: r.score, relativeToPar: r.relativeToPar, durationMs: r.durationMs, playedAt: r.playedAt,
    }));
  const records = buildRecords(bestByCourse(hofRounds));
  const conquered = records.filter((r) => r.played);

  // Trophies via buildTrophyBoard so award-driven SPECIAL badges (e.g. Creator)
  // are flipped to earned from their award row — evaluateTrophies alone leaves
  // them earned:false and they'd never be featured.
  const dates = new Map(awards.map((a) => [a.trophyId, a.unlockedAt ? a.unlockedAt.toISOString() : null]));
  const trophyRounds: TrophyRound[] = rows.map((r) => ({
    relativeToPar: r.relativeToPar, courseKey: r.course.slug, holes: r.holeResults,
  }));
  const stats = summarizeRounds(trophyRounds, COURSES.length, streak?.maxStreak ?? 0);
  const earned = buildTrophyBoard(stats, true, dates).states.filter((s) => s.earned);
  const featured = pickFeatured(profileUser.featuredTrophies, earned);

  // Live streak (0 if the run is dead).
  const today = dateKey();
  const yesterday = previousKey(today);
  const grace = previousKey(yesterday);
  const alive = !!streak && isStreakAlive(streak.currentStreak, streak.lastPlayedKey, today, yesterday, grace);

  const recent: PublicRound[] = [...rows]
    .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
    .slice(0, RECENT)
    .map((r) => {
      const c = courseBySlug(r.course.slug)!;
      return {
        id: r.id,
        courseName: c.name.split("—")[0].trim(),
        par: coursePar(c),
        mode: r.mode === "daily" ? "daily" : "unlimited",
        puzzleNo: r.dateKey ? puzzleNumberForKey(r.dateKey) : null,
        relativeToPar: r.relativeToPar,
        playedAt: r.playedAt.toISOString(),
      };
    });

  return {
    kind: "profile",
    follow,
    profile: {
      username: profileUser.username,
      xHandle: profileUser.xHandle,
      imageUrl: profileUser.imageUrl,
      memberSince: profileUser.createdAt.toISOString(),
      isOwner,
      isPublic: profileUser.profilePublic,
      coursesConquered: conquered.length,
      coursesTotal: COURSES.length,
      bestToPar: conquered.length ? Math.min(...conquered.map((r) => r.relativeToPar!)) : null,
      currentStreak: alive ? streak!.currentStreak : 0,
      bestStreak: streak?.maxStreak ?? 0,
      roundsPlayed: rows.length,
      featured,
      records: conquered.slice(0, CONDENSED_RECORDS),
      recent,
    },
  };
}
