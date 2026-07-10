import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import { getAccountUser } from "@/lib/friends";
import { getLiveState } from "@/lib/challengeBot";

/**
 * GET: live opponent state for a challenge, from my side.
 *
 * The play screen polls this every few seconds. Golf pace makes polling feel
 * live — scores change every 30-90s as someone finishes a hole, so a ~7s poll
 * is indistinguishable from push.
 *
 * Bot opponents come back PACED (you see the bot's hole N once you've finished
 * N holes). Human opponents come back at their real progress.
 */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const limited = await rateLimit("challenge-live", 60, 60_000);
  if (limited) return limited;
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });
  const { id } = await params;

  const state = await getLiveState(me.id, id);
  if (!state) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json(state);
});