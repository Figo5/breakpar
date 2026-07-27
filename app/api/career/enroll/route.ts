import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import { getOrStartUser, GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from "@/lib/user";
import { startCareerJourney } from "@/lib/career/journey";
import { careerStateForUser } from "@/lib/career/read";
import { prisma } from "@/lib/db";

/**
 * POST /api/career/enroll — enroll the caller into their Career world (idempotent
 * via CareerWorldService.enter) and return the current Career state view. A guest
 * identity is minted on first touch, mirroring the round-start flow.
 */
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  const limited = await rateLimit("career-enroll", 20, 60_000);
  if (limited) return limited;

  const { user, newGuestId } = await getOrStartUser();
  // Creates the Journey, season 1, and the locked 1-human + 19-bot field so all
  // four events are immediately playable. Idempotent on repeat calls.
  await startCareerJourney(prisma, user.id);
  const state = await careerStateForUser(prisma, user.id);

  const res = NextResponse.json({ ok: true, userId: user.id, state });
  if (newGuestId) {
    res.cookies.set(GUEST_COOKIE, newGuestId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_COOKIE_MAX_AGE,
    });
  }
  return res;
});
