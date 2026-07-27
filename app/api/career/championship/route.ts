import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { getCurrentUser } from "@/lib/user";
import { careerChampionshipView, careerStateForUser } from "@/lib/career/read";
import { prisma } from "@/lib/db";

/**
 * GET /api/career/championship[?cycle=N] — the Championship field + results for
 * the caller's world (latest cycle unless one is given). Read-only.
 */
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not-enrolled" }, { status: 404 });
  const state = await careerStateForUser(prisma, user.id);
  if (!state) return NextResponse.json({ error: "not-enrolled" }, { status: 404 });

  const cycleParam = new URL(req.url).searchParams.get("cycle");
  const cycle = cycleParam ? Number(cycleParam) : undefined;
  if (cycleParam && (!Number.isSafeInteger(cycle) || (cycle as number) < 1)) {
    return NextResponse.json({ error: "bad-cycle" }, { status: 400 });
  }

  const championship = await careerChampionshipView(
    prisma,
    state.world.id,
    cycle,
    state.profile.id,
  );
  return NextResponse.json({ championship });
});
