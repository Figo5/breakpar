import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import { getAccountUser, searchAccounts, normalizeQuery } from "@/lib/friends";

// GET /api/friends/search?q=  — find accounts by username (accounts-only,
// excludes self, marks already-followed). Empty query returns no results.
export const GET = route(async (req: Request) => {
  const limited = await rateLimit("friends-search", 90, 60_000);
  if (limited) return limited;
  const me = await getAccountUser();
  if (!me) return NextResponse.json({ error: "account-required" }, { status: 403 });

  const q = normalizeQuery(new URL(req.url).searchParams.get("q"));
  if (!q) return NextResponse.json({ results: [] });

  const results = await searchAccounts(me.id, q);
  return NextResponse.json({ results });
});
