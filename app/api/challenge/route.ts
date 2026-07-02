import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import { getAccountUser } from "@/lib/friends";
import { createChallenge, listChallenges } from "@/lib/challenge";

// Accounts-only head-to-head challenges. Guests 403 (mutual-consent feature).

// GET: my challenges, grouped (your turn / waiting / complete).
export const GET = route(async () => {
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });
  return NextResponse.json(await listChallenges(me.id));
});

// POST { opponentUsername, courseSlug? }: create a pending challenge. courseSlug
// omitted -> today's daily course. Opponent must be an account (mutual-consent).
export const POST = route(async (req: Request) => {
  const limited = await rateLimit("challenge-create", 30, 60_000);
  if (limited) return limited;
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });

  const { opponentUsername, courseSlug } = (await req.json().catch(() => ({}))) as {
    opponentUsername?: unknown;
    courseSlug?: unknown;
  };
  if (typeof opponentUsername !== "string" || !opponentUsername.trim())
    return NextResponse.json({ error: "bad-input" }, { status: 400 });

  const res = await createChallenge(
    me.id,
    opponentUsername.trim(),
    typeof courseSlug === "string" && courseSlug ? courseSlug : undefined
  );
  if (!res.ok) {
    const code = res.error === "self" ? 400 : res.error === "not-found" ? 404 : 409;
    return NextResponse.json({ error: res.error }, { status: code });
  }
  return NextResponse.json({ ok: true, id: res.id });
});
