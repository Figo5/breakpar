import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { upgradeCareerSkill } from "@/lib/career/profileProgression";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const limited = await rateLimit("career-development", 30, 60_000);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as {
    skill?: unknown;
    expectedRank?: unknown;
  };
  const result = await upgradeCareerSkill(
    prisma,
    user.id,
    body.skill,
    Number(body.expectedRank),
  );
  if (!result.ok) {
    const status = result.error === "not-enrolled"
      ? 404
      : result.error === "rank-conflict"
        ? 409
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
});
