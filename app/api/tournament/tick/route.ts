import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { cronAuthorizationError } from "@/lib/cronAuth";
import { getActiveTournament, lastCompletedChampion } from "@/lib/tournament.server";

/**
 * TOURNAMENT TICK — the scheduled heartbeat behind the self-activating lifecycle.
 *
 * The lifecycle (create this week's event, run the cut once its deadline passes,
 * settle the champion after it ends) is deliberately LAZY: it runs as a side
 * effect of reading the tournament. That is fine while people are visiting, but
 * it made correctness depend on someone loading a page at the right moment — and
 * when nobody did, a whole week was skipped: no event was created, no course
 * rotated, and the previous champion sat on the banner for a fortnight.
 *
 * This route just performs the read, which is enough to drive every lazy
 * transition. Wired to a daily Vercel cron (see vercel.json) shortly after the
 * midnight-ET boundary, so the week rolls over whether or not anyone is looking.
 * It stays idempotent — the underlying claims (cutComputedAt, winnerUserId, the
 * weekKey upsert) all guard against double-running, so extra ticks are harmless.
 */
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const authError = cronAuthorizationError(req);
  if (authError) return authError;

  const now = new Date();
  const tournament = await getActiveTournament(now);
  const prior = await lastCompletedChampion(now);

  return NextResponse.json({
    ok: true,
    at: now.toISOString(),
    active: tournament
      ? { id: tournament.id, name: tournament.name, course: tournament.courseSlug, phase: tournament.phase }
      : null,
    lastChampion: prior ? { event: prior.tournamentName, username: prior.username } : null,
  });
});
