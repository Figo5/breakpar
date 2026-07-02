/**
 * Friends (Stage 1) — a follow-style social graph on top of public profiles.
 *
 * Model: follows are DIRECTED (A follows B, no accept step). A "friend" is a
 * MUTUAL follow — both edges exist. That keeps v1 low-friction (no request
 * inbox) while still delivering "see my friends' results each day". A true
 * request/accept flow can be added later as an additive status column.
 *
 * Accounts only: every mutation is gated to authenticated accounts (clerkId set)
 * — guests have no social graph. Gating lives in the route handlers and is
 * re-asserted here (defence in depth).
 *
 * Privacy: passive discovery respects the profilePublic toggle. A private
 * friend appears in your list by name, but their score is withheld ("private")
 * exactly like /u/[username] shows strangers — see applyFriendPrivacy.
 */

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { dailyCourse, dateKey, puzzleNumber } from "@/lib/daily";

const SEARCH_LIMIT = 10;

// --- pure helpers (unit-tested; no DB) -------------------------------------

/** Mutual follows = the intersection of who you follow and who follows you.
 * "Friends" in the UI are these ids. Pure. */
export function deriveMutuals(followingIds: string[], followerIds: string[]): Set<string> {
  const followers = new Set(followerIds);
  return new Set(followingIds.filter((id) => followers.has(id)));
}

/** Followers you DON'T follow back = followerIds − followingIds. These are the
 * "Follow back" candidates; following one makes you mutual (a friend). Pure. */
export function nonMutualFollowerIds(followingIds: string[], followerIds: string[]): string[] {
  const iFollow = new Set(followingIds);
  return followerIds.filter((id) => !iFollow.has(id));
}

/** Normalise a search query: trim, drop a leading @, collapse to a bounded
 * token. Empty/whitespace -> null (caller returns no results without a query).
 * Pure. */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().replace(/^@+/, "").slice(0, 40);
  return q.length ? q : null;
}

// mutual (both follow) · following (you -> them only) · follower (them -> you only)
export type FriendState = "friend" | "following" | "follower";

export interface FriendResult {
  score: string | null; // null when hidden or not played
  played: boolean;
  private: boolean; // their profile is private (score withheld)
  puzzleNo: number | null;
}

/**
 * Apply the privacy rule to a friend's daily result for display. A private
 * account never leaks a score through the friends view (passive discovery);
 * they must make their profile public — the same consent the public profile
 * requires. Pure.
 */
export function applyFriendPrivacy(
  isPublic: boolean,
  relativeToPar: number | null,
  puzzleNo: number | null,
  label: (rel: number) => string
): FriendResult {
  if (!isPublic) return { score: null, played: relativeToPar != null, private: true, puzzleNo: null };
  if (relativeToPar == null) return { score: null, played: false, private: false, puzzleNo };
  return { score: label(relativeToPar), played: true, private: false, puzzleNo };
}

// --- data types ------------------------------------------------------------

export interface FriendEntry {
  username: string;
  imageUrl: string | null;
  isPublic: boolean;
  state: FriendState;
  today: FriendResult;
}

export interface SearchHit {
  username: string;
  imageUrl: string | null;
  isPublic: boolean;
  isFollowing: boolean;
  isSelf: boolean;
}

// --- account gate ----------------------------------------------------------

/** The current user IF they're an account (clerkId set); null otherwise.
 * Friends are accounts-only, so guests resolve to null and routes 403. */
export async function getAccountUser() {
  const user = await getCurrentUser();
  return user && user.clerkId ? user : null;
}

// --- queries ---------------------------------------------------------------

/** Resolve a target account by username (accounts only; unique per the partial
 * index). Returns null for guests / unknown / non-accounts. */
export async function resolveAccountByUsername(username: string) {
  return prisma.user.findFirst({
    where: { username, clerkId: { not: null } },
    select: { id: true, username: true },
  });
}

/**
 * Search accounts by username (case-insensitive, prefix-first). Accounts only,
 * excludes the caller, and annotates whether they're already followed. The
 * partial-unique index keeps usernames 1:1 with accounts; the small account
 * table makes a bounded contains-scan fine for v1.
 */
export async function searchAccounts(meId: string, q: string): Promise<SearchHit[]> {
  const rows = await prisma.user.findMany({
    where: {
      clerkId: { not: null },
      username: { contains: q, mode: "insensitive" },
      id: { not: meId },
    },
    select: { id: true, username: true, imageUrl: true, profilePublic: true },
    take: SEARCH_LIMIT,
    orderBy: { username: "asc" },
  });
  const followed = new Set(
    (
      await prisma.follow.findMany({
        where: { followerId: meId, followeeId: { in: rows.map((r) => r.id) } },
        select: { followeeId: true },
      })
    ).map((f) => f.followeeId)
  );
  return rows.map((r) => ({
    username: r.username,
    imageUrl: r.imageUrl,
    isPublic: r.profilePublic,
    isFollowing: followed.has(r.id),
    isSelf: false,
  }));
}

/**
 * The friends view: everyone you follow, marked friend (mutual) vs following
 * (one-way), with their today's daily result (privacy-applied). Friends sorted
 * first, then by username.
 */
/**
 * Hydrate a set of account ids into FriendEntry rows: today's daily result
 * (privacy-applied) + the caller-supplied relationship state. Shared by the
 * friends + followers lists so the row shape/privacy stays in one place.
 */
async function hydrateEntries(
  userIds: string[],
  stateOf: (id: string) => FriendState,
  label: (rel: number) => string
): Promise<FriendEntry[]> {
  if (userIds.length === 0) return [];
  const key = dateKey();
  const puzzleNo = puzzleNumber();
  const todayCourseSlug = dailyCourse().slug;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true, username: true, imageUrl: true, profilePublic: true,
      rounds: {
        where: { dateKey: key, mode: "daily", completed: true, course: { slug: todayCourseSlug } },
        select: { relativeToPar: true },
        take: 1,
      },
    },
  });

  return users
    .map((u): FriendEntry => ({
      username: u.username,
      imageUrl: u.imageUrl,
      isPublic: u.profilePublic,
      state: stateOf(u.id),
      today: applyFriendPrivacy(u.profilePublic, u.rounds[0]?.relativeToPar ?? null, puzzleNo, label),
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * The friends view: everyone you follow, marked friend (mutual) vs following
 * (one-way). Friends sorted first, then by username.
 */
export async function listFriends(
  meId: string,
  label: (rel: number) => string
): Promise<FriendEntry[]> {
  const [following, followers] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: meId }, select: { followeeId: true } }),
    prisma.follow.findMany({ where: { followeeId: meId }, select: { followerId: true } }),
  ]);
  const followeeIds = following.map((f) => f.followeeId);
  if (followeeIds.length === 0) return [];
  const mutuals = deriveMutuals(followeeIds, followers.map((f) => f.followerId));

  const entries = await hydrateEntries(followeeIds, (id) => (mutuals.has(id) ? "friend" : "following"), label);
  // Friends (mutual) first, then following; each already username-sorted.
  return entries.sort((a, b) => (a.state === "friend" ? 0 : 1) - (b.state === "friend" ? 0 : 1));
}

/**
 * Your NON-MUTUAL followers: accounts that follow you but you don't follow back.
 * These are the ones to "Follow back" to become friends. Mutual followers are
 * already surfaced as friends by listFriends, so they're excluded here (no dupes).
 */
export async function listFollowers(
  meId: string,
  label: (rel: number) => string
): Promise<FriendEntry[]> {
  const [following, followers] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: meId }, select: { followeeId: true } }),
    prisma.follow.findMany({ where: { followeeId: meId }, select: { followerId: true } }),
  ]);
  const nonMutual = nonMutualFollowerIds(following.map((f) => f.followeeId), followers.map((f) => f.followerId));
  return hydrateEntries(nonMutual, () => "follower", label);
}

/** Count of accounts who follow you (mutual or not). Cheap headline for the
 * friends page so "nobody follows me back yet" is legible. */
export async function countFollowers(meId: string): Promise<number> {
  return prisma.follow.count({ where: { followeeId: meId } });
}

/** Whether `followerId` currently follows `followeeId`. Used to seed the follow
 * button on a public profile (accounts only; the caller gates guests/self). */
export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const edge = await prisma.follow.findUnique({
    where: { followerId_followeeId: { followerId, followeeId } },
    select: { id: true },
  });
  return !!edge;
}

// --- mutations -------------------------------------------------------------

export type FollowResult =
  | { ok: true; state: FriendState }
  | { ok: false; error: "self" | "not-found" };

/** Follow an account by username. Idempotent (unique edge). Rejects self-follow
 * and non-accounts. Returns whether the pair is now mutual (friend). */
export async function followByUsername(meId: string, username: string): Promise<FollowResult> {
  const target = await resolveAccountByUsername(username);
  if (!target) return { ok: false, error: "not-found" };
  if (target.id === meId) return { ok: false, error: "self" };

  await prisma.follow.upsert({
    where: { followerId_followeeId: { followerId: meId, followeeId: target.id } },
    update: {},
    create: { followerId: meId, followeeId: target.id },
  });

  const reverse = await prisma.follow.findUnique({
    where: { followerId_followeeId: { followerId: target.id, followeeId: meId } },
    select: { id: true },
  });
  return { ok: true, state: reverse ? "friend" : "following" };
}

/** Unfollow an account by username. Idempotent (no-op if not following). */
export async function unfollowByUsername(meId: string, username: string): Promise<FollowResult> {
  const target = await resolveAccountByUsername(username);
  if (!target) return { ok: false, error: "not-found" };
  await prisma.follow.deleteMany({ where: { followerId: meId, followeeId: target.id } });
  return { ok: true, state: "following" };
}
