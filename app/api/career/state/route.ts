import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { getCurrentUser } from "@/lib/user";
import { careerStateWithRepair } from "@/lib/career/read";
import { prisma } from "@/lib/db";

/**
 * GET /api/career/state — the caller's current Career state.
 *
 * On this READ we fire the nonblocking read-repair so a visit nudges a delayed
 * lifecycle forward WITHOUT performing any settlement in the request path (see
 * lib/career/read.ts / repair.ts). We return the last valid view immediately.
 */
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ enrolled: false, state: null });

  const { state } = await careerStateWithRepair(prisma, user.id);
  return NextResponse.json({ enrolled: state != null, state });
});
