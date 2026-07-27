import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { careerLegacyForUser } from "@/lib/career/legacy";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";

/**
 * GET /api/career/legacy — the caller's own Legacy ledger (read-only).
 *
 * Account-scoped by construction: the profile is resolved from the session, and
 * there is no id parameter, so no other player's ledger is addressable. This
 * route performs no writes; repeated calls change nothing.
 */
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const legacy = await careerLegacyForUser(prisma, user.id);
  if (!legacy) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json(legacy);
});
