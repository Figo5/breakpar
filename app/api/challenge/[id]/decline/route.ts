import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getAccountUser } from "@/lib/friends";
import { declineChallenge } from "@/lib/challenge";

// POST: decline a challenge (opponent-only, while pending/active and before they
// have played). A private user can decline cleanly — no profile exposure.
export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });
  const { id } = await params;
  const res = await declineChallenge(me.id, id);
  if (!res.ok) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
