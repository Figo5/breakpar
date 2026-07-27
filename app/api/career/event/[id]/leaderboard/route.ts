import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import {
  careerEventLeaderboard,
  careerProfileOwnsEvent,
  careerStateForUser,
} from "@/lib/career/read";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";

/**
 * GET /api/career/event/[id]/leaderboard — an event's leaderboard (read-only).
 *
 * The caller is resolved so the reveal rule can be applied: opponents' scores
 * stay hidden until the viewer has completed this event (see lib/career/read.ts).
 */
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const state = await careerStateForUser(prisma, user.id);
  if (
    !state
    || !await careerProfileOwnsEvent(prisma, state.profile.id, id)
  ) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const board = await careerEventLeaderboard(prisma, id, state.profile.id);
  if (!board) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json(board);
});
