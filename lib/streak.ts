import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { dateKey, previousKey } from "@/lib/daily";
import { streakStatus, type StreakStatus } from "@/lib/scoring";

/**
 * Today's Eastern civil day plus the two prior civil days, the exact key set
 * `streakStatus` needs. `graceKey` is the day-before-yesterday — the bridge the
 * one-day freeze spans. Pure civil arithmetic via `previousKey`, so DST-safe.
 */
function streakKeys(today = dateKey()) {
  const yesterday = previousKey(today);
  return { today, yesterday, graceKey: previousKey(yesterday) };
}

export interface HomeState {
  signedIn: boolean;
  isAccount: boolean; // clerkId set (true account, not a guest) — gates account-only nav
  streak: number; // effective current day-streak (0 if broken or none)
  streakStatus: StreakStatus; // played-today | safe | at-risk | none
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
  isAccount: false,
  streak: 0,
  streakStatus: "none",
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
  const { today, yesterday, graceKey } = streakKeys();

  const todayRound = await prisma.round.findUnique({
    where: { userId_dateKey: { userId: user.id, dateKey: today } },
    select: { id: true, completed: true },
  });

  const s = streak;
  const status = streakStatus(s?.currentStreak ?? 0, s?.lastPlayedKey, today, yesterday, graceKey);
  const alive = status !== "none";
  const daysPlayed = s?.daysPlayed ?? 0;

  return {
    signedIn: true,
    isAccount: !!user.clerkId, // guests have a User row too; only accounts get friends
    streak: alive ? s!.currentStreak : 0,
    streakStatus: status,
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

export interface StreakBadge {
  streak: number; // current day-streak to celebrate
  isBest: boolean; // ties the player's all-time best (>=2)
}

/**
 * The streak to celebrate on a player's result screen — the triumph-moment
 * reinforcement. Read-only; returns null when there's no LIVE streak so a
 * brand-new / streak-less player renders clean (never "🔥 0-day"). Honours the
 * one-day freeze via `streakStatus`.
 */
export async function getStreakBadge(userId: string): Promise<StreakBadge | null> {
  const s = await prisma.streak.findUnique({ where: { userId } });
  if (!s) return null;
  const { today, yesterday, graceKey } = streakKeys();
  if (streakStatus(s.currentStreak, s.lastPlayedKey, today, yesterday, graceKey) === "none") return null;
  return { streak: s.currentStreak, isBest: s.currentStreak >= 2 && s.currentStreak === s.maxStreak };
}
