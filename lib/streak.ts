import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { dateKey } from "@/lib/daily";
import { isStreakAlive } from "@/lib/scoring";

export interface HomeState {
  signedIn: boolean;
  streak: number; // effective current day-streak (0 if broken or none)
  maxStreak: number; // longest day-streak ever (persists through a miss)
  underParStreak: number; // effective consecutive under-par days
  bestToPar: number | null; // best relative-to-par ever, null if never finished
  daysPlayed: number;
  underParTotal: number; // total under-par days
  winPct: number | null; // underParTotal / daysPlayed, null if never played
  playedTodayRoundId: string | null; // today's round, if already completed
  inProgressRoundId: string | null; // today's round, if started but unfinished
}

const EMPTY: HomeState = {
  signedIn: false,
  streak: 0,
  maxStreak: 0,
  underParStreak: 0,
  bestToPar: null,
  daysPlayed: 0,
  underParTotal: 0,
  winPct: null,
  playedTodayRoundId: null,
  inProgressRoundId: null,
};

/**
 * Streak/best stats for the signed-in player, for the home screen.
 *
 * Read-only: it must NOT create a user (the home page is public and a mere
 * visit shouldn't provision an account). The stored currentStreak is only
 * "alive" if the last played day was today or yesterday — otherwise the run of
 * consecutive days is already broken and we display 0, the same way Wordle
 * drops your streak once you miss a day.
 */
export async function getHomeState(): Promise<HomeState> {
  const user = await getCurrentUser();
  if (!user) return EMPTY;

  const streak = await prisma.streak.findUnique({ where: { userId: user.id } });
  const today = dateKey();
  const yesterday = dateKey(new Date(Date.now() - 86_400_000));

  const todayRound = await prisma.round.findUnique({
    where: { userId_dateKey: { userId: user.id, dateKey: today } },
    select: { id: true, completed: true },
  });

  const s = streak;
  const alive = !!s && isStreakAlive(s.lastPlayedKey, today, yesterday);
  const daysPlayed = s?.daysPlayed ?? 0;

  return {
    signedIn: true,
    streak: alive ? s!.currentStreak : 0,
    maxStreak: s?.maxStreak ?? 0, // headline stat — never reset by a miss
    underParStreak: alive ? s!.underParStreak : 0,
    bestToPar: s && s.bestScore < 999 ? s.bestScore : null,
    daysPlayed,
    underParTotal: s?.underParTotal ?? 0,
    winPct: daysPlayed > 0 ? Math.round(((s?.underParTotal ?? 0) / daysPlayed) * 100) : null,
    playedTodayRoundId: todayRound?.completed ? todayRound.id : null,
    inProgressRoundId: todayRound && !todayRound.completed ? todayRound.id : null,
  };
}
