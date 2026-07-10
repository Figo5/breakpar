import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import { getAccountUser } from "@/lib/friends";
import { createBotChallenge } from "@/lib/challengeBot";
import { startOrResumeChallengeRound } from "@/lib/challenge";
import { BOTS } from "@/lib/botPlayer";

// GET: the bot roster (for the picker UI).
export const GET = route(async () => {
  return NextResponse.json({
    bots: Object.entries(BOTS).map(([key, b]) => ({
      key,
      name: b.displayName,
      blurb: b.blurb,
    })),
  });
});

// POST { bot, courseSlug? }: create a bot challenge AND start my round, in one
// call — a bot has no inbox, so there's nothing to wait for. Returns both ids
// so the client can navigate straight into the round.
export const POST = route(async (req: Request) => {
  const limited = await rateLimit("challenge-bot-create", 20, 60_000);
  if (limited) return limited;
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });

  const { bot, courseSlug } = (await req.json().catch(() => ({}))) as {
    bot?: unknown;
    courseSlug?: unknown;
  };
  if (typeof bot !== "string" || !(bot in BOTS))
    return NextResponse.json({ error: "unknown-bot" }, { status: 400 });
  if (courseSlug !== undefined && typeof courseSlug !== "string")
    return NextResponse.json({ error: "bad-input" }, { status: 400 });

  const created = await createBotChallenge(me.id, bot, courseSlug);
  if (!created.ok) {
    console.error(`[challenge/bot] create failed: ${created.error}`);
    return NextResponse.json({ error: created.error }, { status: 400 });
  }

  const started = await startOrResumeChallengeRound(me.id, created.id);
  if (!started.ok) {
    console.error(`[challenge/bot] start failed: ${started.error} (challenge ${created.id})`);
    return NextResponse.json({ error: started.error }, { status: 500 });
  }

  return NextResponse.json({ challengeId: created.id, roundId: started.roundId });
});