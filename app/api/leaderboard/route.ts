import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { dateKey } from "@/lib/daily";
import { topBoard, fieldStats } from "@/lib/leaderboard";
import { route } from "@/lib/api";

// GET: today's top 25 plus the current player's rank.
export const GET = route(async () => {
  const key = dateKey();

  // The board and the current player's own round are independent reads.
  const [top, user] = await Promise.all([topBoard(key, 25), getCurrentUser()]);

  const board = top.map((r) => ({
    rank: r.rank,
    username: r.username,
    xHandle: r.xHandle,
    score: r.score,
    durationMs: r.durationMs,
  }));

  let you: { rank: number; score: number } | null = null;
  if (user) {
    const mine = await prisma.round.findUnique({
      where: { userId_dateKey: { userId: user.id, dateKey: key } },
    });
    if (mine?.completed) {
      const { rank } = await fieldStats(key, mine.score);
      you = { rank, score: mine.score };
    }
  }

  return NextResponse.json({ dateKey: key, board, you });
});
