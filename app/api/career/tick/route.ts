import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runCareerTick } from "@/lib/career/scheduler";

/**
 * CAREER TICK — the recovery heartbeat that re-drives any due Career Mode work
 * left behind by an interrupted request (formation, event/season/Championship
 * settlement, field publication, or bot materialization).
 *
 * Normal player-paced progression happens immediately on the initiating write
 * path. This route invokes those same fenced, idempotent services (see
 * lib/career/scheduler.ts), so extra or concurrent ticks are harmless. It has a
 * separate Vercel cron from the Tournament tick.
 */
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  // Vercel signs cron invocations with CRON_SECRET when it's configured. Enforce
  // it when set so the endpoint can't drive the lifecycle from outside; when
  // unset (local dev) it stays open. Mirrors the Tournament tick.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const summary = await runCareerTick(prisma);
  return NextResponse.json({ ok: true, ...summary });
});
