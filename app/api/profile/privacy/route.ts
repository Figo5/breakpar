import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { route } from "@/lib/api";

// PATCH: flip the caller's own profile public/private. Owner-only by
// construction — it always operates on the authenticated account (never a
// client-supplied id), and guests (no clerkId) have no profile to toggle.
export const PATCH = route(async (req: Request) => {
  const user = await getCurrentUser();
  if (!user || !user.clerkId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { public?: unknown };
  if (typeof body.public !== "boolean")
    return NextResponse.json({ error: "bad-input" }, { status: 400 });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { profilePublic: body.public },
    select: { profilePublic: true },
  });
  return NextResponse.json({ profilePublic: updated.profilePublic });
});
