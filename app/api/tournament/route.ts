import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import { getAccountUser } from "@/lib/friends";
import { getCurrentUser } from "@/lib/user";
import { getActiveTournament, joinTournament, myTournamentProgress } from "@/lib/tournament.server";

// GET: the current tournament view. If signed in as an account, also returns my
// progress (joined, cumulative to-par, which rounds are playable). Guests get
// the tournament view only (so the teaser/standings can render) — joining and
// playing require an account.
export const GET = route(async () => {
  const user = await getCurrentUser();
  if (user?.clerkId) {
const progress = await myTournamentProgress(user.id, new Date(), user.username);    if (!progress) return NextResponse.json({ tournament: null });
    return NextResponse.json(progress);
  }
  const tournament = await getActiveTournament();
  return NextResponse.json({ tournament, me: null });
});

// POST: join the current tournament (accounts only, idempotent).
export const POST = route(async () => {
  const limited = await rateLimit("tournament-join", 30, 60_000);
  if (limited) return limited;
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });

  const res = await joinTournament(me.id);
  if (!res.ok) {
    const code = res.error === "not-found" ? 404 : 409;
    return NextResponse.json({ error: res.error }, { status: code });
  }
  return NextResponse.json({ ok: true, entryId: res.entryId });
});
