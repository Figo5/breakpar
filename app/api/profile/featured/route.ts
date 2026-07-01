import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { getTrophies } from "@/lib/trophies.server";
import { validateFeatured } from "@/lib/trophies";
import { route } from "@/lib/api";

// PATCH: set the caller's pinned trophies (ordered, <=5). Owner-only by
// construction. Server-validates every id is a CURRENTLY-EARNED trophy so a
// crafted request can't pin a locked/unknown trophy.
export const PATCH = route(async (req: Request) => {
  const user = await getCurrentUser();
  if (!user || !user.clerkId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { trophyIds?: unknown };
  if (!Array.isArray(body.trophyIds) || body.trophyIds.some((x) => typeof x !== "string"))
    return NextResponse.json({ error: "bad-input" }, { status: 400 });

  // Every pinned id must be a trophy this user has actually earned (server-side).
  const board = await getTrophies();
  const earned = new Set((board?.states ?? []).filter((s) => s.earned).map((s) => s.id));
  const v = validateFeatured(body.trophyIds as string[], earned);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { featuredTrophies: v.ids },
    select: { featuredTrophies: true },
  });
  return NextResponse.json({ featuredTrophies: updated.featuredTrophies });
});
