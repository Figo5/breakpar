import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { getCurrentUser } from "@/lib/user";
import {
  careerProfileOwnsCohort,
  careerSeasonTable,
  careerStateForUser,
} from "@/lib/career/read";
import { prisma } from "@/lib/db";

/**
 * GET /api/career/season/standings[?cohortId=...] — season standings for a cohort
 * (read-only). Defaults to the caller's current cohort when no cohortId is given.
 *
 * The full twenty-player field is returned from the moment the season exists;
 * event results are revealed against the CALLER's own progress, so the response
 * is viewer-scoped and must never be shared between players.
 */
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const state = await careerStateForUser(prisma, user.id);
  if (!state) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const requestedCohortId = new URL(req.url).searchParams.get("cohortId");
  const cohortId = requestedCohortId ?? state.cohort?.id;
  if (
    !cohortId
    || !await careerProfileOwnsCohort(prisma, state.profile.id, cohortId)
  ) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const table = await careerSeasonTable(prisma, cohortId, state.profile.id);
  if (!table) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json(table);
});
