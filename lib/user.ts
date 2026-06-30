import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { normalizeXHandle } from "@/lib/xHandle";
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
 * Find or create the Clerk-backed user. If the visitor was playing as a guest,
 * we ADOPT that guest row (attach the clerkId) so their rounds and streak carry
 * over seamlessly instead of starting fresh.
 */
async function upsertClerkUser(clerkId: string, guestId?: string | null): Promise<User> {
  const cu = await currentUser();
  // The X/Twitter @handle lives on the OAuth external account's `username`
  // (confirmed via scripts/inspect-x-handle.ts). Validate to handle-only form.
  const xHandle = normalizeXHandle(
    cu?.externalAccounts?.find((e) => e.provider === "oauth_x")?.username
  );

  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) {
    // Backfill / refresh the handle if Clerk now has one and we don't (or it
    // changed). Cheap no-op write avoided when nothing's different.
    if (xHandle && existing.xHandle !== xHandle) {
      return prisma.user.update({ where: { id: existing.id }, data: { xHandle } });
    }
    return existing;
  }

  const email = cu?.emailAddresses[0]?.emailAddress ?? null;
  const username = cu?.username ?? `${cu?.firstName ?? "golfer"}-${clerkId.slice(-6)}`;

  // Upgrade an existing guest into this account.
  if (guestId) {
    const guest = await prisma.user.findUnique({ where: { guestId } });
    if (guest && !guest.clerkId) {
      return prisma.user.update({
        where: { id: guest.id },
        data: { clerkId, username: cu?.username ?? guest.username, email, xHandle },
      });
    }
  }

  // Otherwise create (atomically, to dodge the find-then-create race).
  return prisma.user.upsert({
    where: { clerkId },
    update: xHandle ? { xHandle } : {},
    create: { clerkId, username, email, xHandle },
  });
}
