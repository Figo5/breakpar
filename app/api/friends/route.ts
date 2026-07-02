import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import { relativeLabel } from "@/lib/scoring";
import {
  getAccountUser,
  listFriends,
  followByUsername,
  unfollowByUsername,
} from "@/lib/friends";

// Accounts-only social graph. Every handler 403s guests (no clerkId) — friends
// are an account feature by design (and a conversion driver).

// GET: your friends view — everyone you follow (friend = mutual), with today's
// daily result (privacy-applied).
export const GET = route(async () => {
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });
  const friends = await listFriends(me.id, relativeLabel);
  return NextResponse.json({ friends });
});

// POST { username }: follow an account. Idempotent; returns friend|following.
export const POST = route(async (req: Request) => {
  const limited = await rateLimit("friends-follow", 60, 60_000);
  if (limited) return limited;
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });

  const { username } = (await req.json().catch(() => ({}))) as { username?: unknown };
  if (typeof username !== "string" || !username.trim())
    return NextResponse.json({ error: "bad-input" }, { status: 400 });

  const res = await followByUsername(me.id, username.trim());
  if (!res.ok)
    return NextResponse.json(
      { error: res.error === "self" ? "cannot-follow-self" : "not-found" },
      { status: res.error === "self" ? 400 : 404 }
    );
  return NextResponse.json({ ok: true, state: res.state });
});

// DELETE { username }: unfollow. Idempotent.
export const DELETE = route(async (req: Request) => {
  const limited = await rateLimit("friends-follow", 60, 60_000);
  if (limited) return limited;
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });

  const { username } = (await req.json().catch(() => ({}))) as { username?: unknown };
  if (typeof username !== "string" || !username.trim())
    return NextResponse.json({ error: "bad-input" }, { status: 400 });

  const res = await unfollowByUsername(me.id, username.trim());
  if (!res.ok) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
