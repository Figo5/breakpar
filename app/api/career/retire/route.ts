import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { startCareerJourney } from "@/lib/career/journey";
import { retireCareerJourney } from "@/lib/career/profileProgression";
import { careerStateForUser } from "@/lib/career/read";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const limited = await rateLimit("career-retire", 5, 60_000);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as {
    confirmation?: unknown;
    profileId?: unknown;
  };
  if (body.confirmation !== "RETIRE") {
    return NextResponse.json({ error: "confirmation-required" }, { status: 400 });
  }
  if (typeof body.profileId !== "string") {
    return NextResponse.json({ error: "profile-required" }, { status: 400 });
  }
  const result = await retireCareerJourney(prisma, user.id, body.profileId);
  if (!result.ok) {
    const status = result.error === "not-enrolled" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  // Formation is its own idempotent fenced transaction. If it ever fails after
  // the archive commits, retrying this request replays the retirement and then
  // creates the same next numbered Career—never a duplicate.
  await startCareerJourney(prisma, user.id);
  const state = await careerStateForUser(prisma, user.id);
  return NextResponse.json({ ...result, state });
});
