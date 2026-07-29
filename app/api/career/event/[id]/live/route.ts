import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import {
  careerLiveLeaderboard,
  careerProfileOwnsEvent,
  careerStateForUser,
} from "@/lib/career/read";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";

/**
 * GET /api/career/event/[id]/live — the leaderboard during a Career round.
 *
 * Viewer-scoped and strictly read-only. Every competitor is reported through
 * the same hole the CALLER has completed, so a rival's later holes are never
 * summed and no future score is addressable from this endpoint. It settles
 * nothing, creates no rounds, and never rerolls a bot card.
 */
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const state = await careerStateForUser(prisma, user.id);
  if (!state || !await careerProfileOwnsEvent(prisma, state.profile.id, id)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const board = await careerLiveLeaderboard(prisma, id, state.profile.id);
  if (!board) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json(board);
});
