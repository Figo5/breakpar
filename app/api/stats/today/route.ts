import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { dateKey, puzzleNumber } from "@/lib/daily";

// Public, read-only glance at today's daily field — "how many finished today".
// Scoped EXACTLY like the percentile query (lib/leaderboard.fieldStats): today's
// UTC dateKey + completed. Practice rounds carry dateKey = null, so a specific
// dateKey already excludes them. `completed` IS the field size behind the
// percentile. Short cache so it's fresh-ish without hammering the DB.
export const revalidate = 60;

export const GET = route(async () => {
  const key = dateKey();
  const completed = await prisma.round.count({ where: { dateKey: key, completed: true } });
  return NextResponse.json({ dateKey: key, puzzleNumber: puzzleNumber(), completed, fieldSize: completed });
});
