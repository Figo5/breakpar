import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { normalizeXHandle } from "@/lib/xHandle";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";

export const GUEST_COOKIE = "bp_guest";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Read the current player WITHOUT creating anything. Resolves a Clerk user if
 * signed in, otherwise the guest identity from the cookie. Safe to call from
 * public pages (home, leaderboard, result).
 */
export async function getCurrentUser(): Promise<User | null> {
  const { userId: clerkId } = await auth();
  const guestId = (await cookies()).get(GUEST_COOKIE)?.value ?? null;
  // Pass the guest cookie so a signed-in player's first touch (even just the
  // home page) adopts their guest history rather than spawning a fresh account.
  if (clerkId) return upsertClerkUser(clerkId, guestId);

  if (guestId) return prisma.user.findUnique({ where: { guestId } });
  return null;
}

/**
 * Resolve the player for a round START, provisioning an anonymous guest if
 * they're not signed in. Returns the new guest id (if minted) so the caller can
 * set the cookie on its response. This is what kills the sign-in wall: anyone
 * can play instantly, and signing in later "upgrades" the same identity.
 */
export async function getOrStartUser(): Promise<{ user: User; newGuestId: string | null }> {
  const { userId: clerkId } = await auth();
  const guestId = (await cookies()).get(GUEST_COOKIE)?.value ?? null;

  if (clerkId) return { user: await upsertClerkUser(clerkId, guestId), newGuestId: null };

  if (guestId) {
    const existing = await prisma.user.findUnique({ where: { guestId } });
    if (existing) return { user: existing, newGuestId: null };
  }

  // Mint a fresh guest. Retry once on the (astronomically unlikely) id clash.
  const newGuestId = randomUUID();
  const user = await prisma.user.create({
    data: { guestId: newGuestId, username: `Guest-${newGuestId.slice(0, 4)}` },
  });
  return { user, newGuestId };
}

/**
 * Clerk's Backend API (used by `currentUser()`) throttles under load and throws
 * a 429. Duck-typed rather than importing @clerk/shared internals: it's a
 * transitive dep with no stable `/error` subpath export.
 */
function isClerkRateLimited(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { clerkError?: unknown }).clerkError === true &&
    (e as { status?: unknown }).status === 429
  );
}

// Ride out brief Clerk rate-limit spikes with a couple of short backoffs before
// giving up. Kept small so we never hold a serverless invocation open for long.
const CLERK_RETRY_BACKOFF_MS = [150, 400];

async function currentUserWithRetry() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await currentUser();
    } catch (e) {
      if (isClerkRateLimited(e) && attempt < CLERK_RETRY_BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, CLERK_RETRY_BACKOFF_MS[attempt]));
        continue;
      }
      throw e;
    }
  }
}

/**
 * Find or create the Clerk-backed user. If the visitor was playing as a guest,
 * we ADOPT that guest row (attach the clerkId) so their rounds and streak carry
 * over seamlessly instead of starting fresh.
 */
async function upsertClerkUser(clerkId: string, guestId?: string | null): Promise<User> {
  let cu: Awaited<ReturnType<typeof currentUser>>;
  try {
    cu = await currentUserWithRetry();
  } catch (e) {
    // Clerk still rate-limiting after retries. This call only re-syncs display
    // identity (username/avatar/handle), which tolerates being one request stale,
    // so degrade to the last-known DB row rather than 500-ing the route. A brand-
    // new user we've never stored can't be identified without Clerk — let that
    // propagate; the API wrapper turns it into a retryable 503, not a 500.
    if (isClerkRateLimited(e)) {
      const known = await prisma.user.findUnique({ where: { clerkId } });
      if (known) return known;
    }
    throw e;
  }
  // The X/Twitter @handle lives on the OAuth external account's `username`
  // (confirmed via scripts/inspect-x-handle.ts). Validate to handle-only form.
  const xHandle = normalizeXHandle(
    cu?.externalAccounts?.find((e) => e.provider === "oauth_x")?.username
  );

  // Clerk is the source of truth for the display identity. Only take a username
  // when Clerk actually has one — never clobber a real name with the fallback.
  const clerkUsername = cu?.username ?? null;
  const imageUrl = cu?.imageUrl ?? null;

  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) {
    // Re-sync the display identity from Clerk on login (username + avatar +
    // handle). Without this the DB keeps whatever was stamped at signup, so a
    // later Clerk rename/avatar change never shows. Only write what changed, and
    // only overwrite username when Clerk has a real one (differing from ours).
    const data: { username?: string; imageUrl?: string | null; xHandle?: string } = {};
    if (clerkUsername && clerkUsername !== existing.username) data.username = clerkUsername;
    if (imageUrl !== existing.imageUrl) data.imageUrl = imageUrl;
    if (xHandle && existing.xHandle !== xHandle) data.xHandle = xHandle;
    if (Object.keys(data).length === 0) return existing; // nothing changed
    try {
      return await prisma.user.update({ where: { id: existing.id }, data });
    } catch (e) {
      // The partial-unique index on account usernames could reject a rename that
      // collides (near-impossible — Clerk enforces username uniqueness). Don't
      // 500 the hot path: keep the current row, still applying avatar/handle.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const { username: _drop, ...safe } = data;
        if (Object.keys(safe).length === 0) return existing;
        return prisma.user.update({ where: { id: existing.id }, data: safe });
      }
      throw e;
    }
  }

  const email = cu?.emailAddresses[0]?.emailAddress ?? null;
  const username = clerkUsername ?? `${cu?.firstName ?? "golfer"}-${clerkId.slice(-6)}`;

  // Upgrade an existing guest into this account.
  if (guestId) {
    const guest = await prisma.user.findUnique({ where: { guestId } });
    if (guest && !guest.clerkId) {
      return prisma.user.update({
        where: { id: guest.id },
        data: { clerkId, username: clerkUsername ?? guest.username, email, xHandle, imageUrl },
      });
    }
  }

  // Otherwise create (atomically, to dodge the find-then-create race).
  return prisma.user.upsert({
    where: { clerkId },
    update: { ...(xHandle ? { xHandle } : {}), ...(imageUrl ? { imageUrl } : {}) },
    create: { clerkId, username, email, xHandle, imageUrl },
  });
}
