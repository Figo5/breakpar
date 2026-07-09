/**
 * Tournaments — server operations (DB). Pairs with lib/tournament.ts (pure
 * logic). Handles: ensuring the current week's tournament row exists, joining,
 * starting/resuming a tournament round (shared per-round seed, one attempt per
 * round), settling a finished round, computing the cut lazily when due, and
 * building standings.
 *
 * Tournament rounds are mode="tournament": OUTSIDE the daily rotation, streak,
 * daily leaderboard, trophies and HoF (a shared/known seed must not farm
 * records) — mirrors the challenge exclusion. Accounts only.
 *
 * SELF-ACTIVATING: getActiveTournament() derives phase from the clock and lazily
 * (a) refreshes the cached status and (b) runs the one-time cut once its deadline
 * has passed — so the tournament advances with no cron, purely on reads.
 */

import { prisma } from "@/lib/db";
import { courseBySlug, coursePar, type Course } from "@/data/courses";
import {
  tournamentCourseSlugFor,
  TOURNAMENT_FALLBACK_SLUG,
  CUT_PERCENT,
  CUT_MIN,
  PRE_CUT_ROUNDS,
  scheduleForUpcoming,
  scheduleFromStart,
  phaseFor,
  playableRounds,
  cutIsDue,
  computeCut,
  tournamentSeedKey,
  cutlineScore,
  type TournamentPhase,
  type CutCandidate,
} from "@/lib/tournament";

/** Exclude tournament rounds from lifetime stats (mirrors NON_CHALLENGE). */
export const NON_TOURNAMENT = { mode: { not: "tournament" } } as const;

// --- preview override (you-only early playtest) ----------------------------

/**
 * Usernames allowed to PREVIEW the tournament before its public start (play the
 * full flow on the live site pre-Monday). Set TOURNAMENT_PREVIEW_USERS to a
 * comma-separated list (e.g. "founder"). For these users, "upcoming" is treated
 * as if the tournament had started, and the cut/rounds are all open so the whole
 * flow can be exercised. Everyone else sees the real clock-derived phase.
 */
function previewUsernames(): string[] {
  return (process.env.TOURNAMENT_PREVIEW_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPreviewUser(username: string | null | undefined): boolean {
  if (!username) return false;
  return previewUsernames().includes(username.toLowerCase());
}

/**
 * The phase as seen by a given viewer. For a preview user before the public
 * start, we surface an "all open" preview so they can play any round: we map
 * "upcoming" -> "round1_2" (rounds 1-4 all playable via the preview flag on
 * playableRounds below). For everyone else it's the real phase.
 */
export function viewerPhase(
  realPhase: TournamentPhase,
  isPreview: boolean
): TournamentPhase {
  if (isPreview && realPhase === "upcoming") return "round1_2";
  return realPhase;
}

// --- ensure / fetch the current tournament ---------------------------------

type TournamentRow = {
  id: string;
  weekKey: string;
  courseId: string;
  name: string;
  startsAt: Date;
  cutAt: Date;
  endsAt: Date;
  cutPercent: number;
  cutMin: number;
  status: string;
  cutComputedAt: Date | null;
  winnerUserId: string | null;
};

/**
 * The tournament for the current/upcoming week, creating the row if missing.
 * Idempotent on weekKey (@unique). We anchor to the UPCOMING Monday's week: the
 * first tournament is created lazily the first time anyone views tournaments.
 */
async function ensureCurrentTournament(now = new Date()): Promise<TournamentRow | null> {
  // If a tournament is currently live (start <= now < end), use it; otherwise
  // create/fetch the one for the upcoming Monday.
  const live = (await prisma.tournament.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: "desc" },
  })) as TournamentRow | null;
  if (live) return live;

  const sched = scheduleForUpcoming(now);
  // Course for this week: hand-picked override (major week) else the rotation.
  // Fall back to the launch course if a configured slug isn't in the roster, so
  // a config typo can never stop a tournament from being created.
  const slug = tournamentCourseSlugFor(sched.weekKey);
  const course = courseBySlug(slug) ?? courseBySlug(TOURNAMENT_FALLBACK_SLUG);
  if (!course) return null;
  const courseRow = await prisma.course.findUnique({ where: { slug: course.slug }, select: { id: true } });
  if (!courseRow) return null;

  // Upsert on weekKey so concurrent first-views don't duplicate.
  const t = (await prisma.tournament.upsert({
    where: { weekKey: sched.weekKey },
    update: {},
    create: {
      weekKey: sched.weekKey,
      courseId: courseRow.id,
      name: `${course.name.split("—")[0].trim()} Championship`,
      startsAt: sched.startsAt,
      cutAt: sched.cutAt,
      endsAt: sched.endsAt,
      cutPercent: CUT_PERCENT,
      cutMin: CUT_MIN,
      status: "upcoming",
    },
  })) as TournamentRow;
  return t;
}

// --- public shapes ---------------------------------------------------------

export interface TournamentView {
  id: string;
  name: string;
  courseSlug: string;
  courseName: string;
  par: number;
  phase: TournamentPhase;
  isPreview: boolean;
  startsAt: string;
  cutAt: string;
  endsAt: string;
  playableRounds: number[];
  cutPercent: number;
  cutMin: number;
  fieldSize: number;
  cutLine: number | null; // current cut-line score during rounds 1-2 (else null)
  champion: { username: string; cumulativeToPar: number } | null; // once complete
}

function courseView(course: Course) {
  return { slug: course.slug, name: course.name.split("—")[0].trim(), par: coursePar(course) };
}

/**
 * The live tournament view — derives phase from the clock, lazily refreshes the
 * cached status, and runs the cut if it's due. Safe to call on every read.
 * `viewerUsername` enables the preview override for allowed users.
 */
export async function getActiveTournament(
  now = new Date(),
  viewerUsername?: string | null
): Promise<TournamentView | null> {
  const t = await ensureCurrentTournament(now);
  if (!t) return null;

  const sched = { startsAt: t.startsAt, cutAt: t.cutAt, endsAt: t.endsAt };
  const realPhase = phaseFor(sched, now);
  const preview = isPreviewUser(viewerUsername);
  const phase = viewerPhase(realPhase, preview);

  // Lazily run the cut once we're past the deadline and it hasn't been computed.
  // (Never triggered by preview — preview doesn't move the real clock.)
  if (cutIsDue(sched, t.cutComputedAt, now)) {
    await runCut(t.id);
  }

  // Lazily settle the winner once we're past endsAt and it hasn't been settled.
  if (realPhase === "complete" && !t.winnerUserId) {
    await settleTournament(t.id);
  }

  // Refresh the cached status column if it drifted (cheap, best-effort). Cache
  // the REAL phase, not the preview one.
  if (t.status !== realPhase) {
    await prisma.tournament.updateMany({ where: { id: t.id, status: { not: realPhase } }, data: { status: realPhase } });
  }

  // Resolve THIS tournament's course from its stored courseId (NOT a hardcoded
  // slug) — with rotation, each week's tournament has a different course, and
  // gameplay already uses t.courseId. Falls back safely if the row is missing.
  const courseRow = await prisma.course.findUnique({ where: { id: t.courseId }, select: { slug: true } });
  const course = (courseRow ? courseBySlug(courseRow.slug) : null) ?? courseBySlug(TOURNAMENT_FALLBACK_SLUG)!;
  const cv = courseView(course);
  const fieldSize = await prisma.tournamentEntry.count({ where: { tournamentId: t.id } });

  // Current cutline (during rounds 1-2 only): the score at the cut position
  // among players who've completed BOTH pre-cut rounds so far. Null otherwise.
  let cutLine: number | null = null;
  if (phase === "round1_2") {
    cutLine = await computeCurrentCutline(t.id, t.cutPercent, t.cutMin);
  }

  // Champion (once complete + settled). winnerUserId "" means "no eligible winner".
  let champion: { username: string; cumulativeToPar: number } | null = null;
  const settled = await prisma.tournament.findUnique({ where: { id: t.id }, select: { winnerUserId: true } });
  if (realPhase === "complete" && settled?.winnerUserId) {
    // Look up the actual settled winner (settleTournament applied the time tiebreak).
    const winnerEntry = await prisma.tournamentEntry.findFirst({
      where: { tournamentId: t.id, userId: settled.winnerUserId },
      select: {
        user: { select: { username: true } },
        rounds: { where: { tournamentRoundNo: { not: null }, completed: true }, select: { relativeToPar: true } },
      },
    });
    if (winnerEntry) {
      champion = {
        username: winnerEntry.user.username,
        cumulativeToPar: winnerEntry.rounds.reduce((s, r) => s + r.relativeToPar, 0),
      };
    }
  }

  return {
    id: t.id,
    name: t.name,
    courseSlug: course.slug,
    courseName: cv.name,
    par: cv.par,
    phase,
    isPreview: preview,
    startsAt: t.startsAt.toISOString(),
    cutAt: t.cutAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    // Preview users can play all 4 rounds; everyone else gets the real phase's rounds.
    playableRounds: preview && realPhase === "upcoming" ? [1, 2, 3, 4] : playableRounds(phase),
    cutPercent: t.cutPercent,
    cutMin: t.cutMin,
    fieldSize,
    cutLine,
    champion,
  };
}

// --- join ------------------------------------------------------------------

export type JoinResult =
  | { ok: true; entryId: string }
  | { ok: false; error: "not-found" | "closed" };

/** Join the current tournament (idempotent — one entry per user). Allowed while
 * the tournament is not yet complete. */
export async function joinTournament(userId: string, now = new Date()): Promise<JoinResult> {
  const t = await ensureCurrentTournament(now);
  if (!t) return { ok: false, error: "not-found" };
  if (phaseFor(t, now) === "complete") return { ok: false, error: "closed" };

  const entry = await prisma.tournamentEntry.upsert({
    where: { tournamentId_userId: { tournamentId: t.id, userId } },
    update: {},
    create: { tournamentId: t.id, userId },
    select: { id: true },
  });
  return { ok: true, entryId: entry.id };
}

// --- start / resume a tournament round -------------------------------------

export type StartRoundResult =
  | { ok: true; roundId: string }
  | { ok: false; error: "not-found" | "closed" | "not-open" | "cut" | "already-complete" };

/**
 * Start or resume MY round `roundNo` in the current tournament. Enforces:
 * - the round must be playable in the current phase (rounds 1-2 pre-cut, 3-4 post),
 * - I must have made the cut to play 3-4,
 * - one attempt per round (the @@unique([tournamentEntryId, tournamentRoundNo])
 *   plus a conditional link, mirroring the challenge race-safety).
 * Auto-joins on first play. Shared per-round seed = "{tournamentId}:{roundNo}".
 */
export async function startTournamentRound(
  userId: string,
  roundNo: number,
  now = new Date(),
  viewerUsername?: string | null
): Promise<StartRoundResult> {
  const t = await ensureCurrentTournament(now);
  if (!t) return { ok: false, error: "not-found" };
  const realPhase = phaseFor(t, now);
  const preview = isPreviewUser(viewerUsername);
  const phase = viewerPhase(realPhase, preview);
  if (phase === "complete") return { ok: false, error: "closed" };
  // Preview users (pre-start) may play any of the 4 rounds; others are phase-gated.
  const canPlay = preview && realPhase === "upcoming" ? [1, 2, 3, 4] : playableRounds(phase);
  if (!canPlay.includes(roundNo)) return { ok: false, error: "not-open" };

  // Ensure the entry (auto-join on first play).
  const entry = await prisma.tournamentEntry.upsert({
    where: { tournamentId_userId: { tournamentId: t.id, userId } },
    update: {},
    create: { tournamentId: t.id, userId },
    select: { id: true, madeCut: true },
  });

  // Rounds 3-4 require having made the cut — except in preview (no cut yet).
  if (roundNo > PRE_CUT_ROUNDS && entry.madeCut === false && !preview) {
    return { ok: false, error: "cut" };
  }

  // Resume if this round already exists for the entry.
  const existing = await prisma.round.findFirst({
    where: { tournamentEntryId: entry.id, tournamentRoundNo: roundNo },
    select: { id: true, completed: true },
  });
  if (existing) {
    if (existing.completed) return { ok: false, error: "already-complete" };
    return { ok: true, roundId: existing.id };
  }

  // Create the round with the shared per-round seed. The @@unique makes a
  // concurrent double-create safe: the loser catches P2002 and resumes.
  try {
    const round = await prisma.round.create({
      data: {
        userId,
        courseId: t.courseId,
        mode: "tournament",
        dateKey: null,
        seedKey: tournamentSeedKey(t.id, roundNo),
        tournamentEntryId: entry.id,
        tournamentRoundNo: roundNo,
      },
      select: { id: true },
    });
    return { ok: true, roundId: round.id };
  } catch {
    // Lost the create race — resume the winner.
    const winner = await prisma.round.findFirst({
      where: { tournamentEntryId: entry.id, tournamentRoundNo: roundNo },
      select: { id: true, completed: true },
    });
    if (winner && !winner.completed) return { ok: true, roundId: winner.id };
    if (winner?.completed) return { ok: false, error: "already-complete" };
    return { ok: false, error: "not-found" };
  }
}

// --- cut (lazy, idempotent) ------------------------------------------------

/**
 * Compute and persist the cut for a tournament, once. Ranks entries by their
 * cumulative to-par over the completed pre-cut rounds; top cutPercent% (min
 * cutMin, ties extended) get madeCut=true, the rest false; entries that didn't
 * finish both pre-cut rounds are withdrawn. Idempotent via cutComputedAt.
 */
export async function runCut(tournamentId: string): Promise<void> {
  const t = (await prisma.tournament.findUnique({ where: { id: tournamentId } })) as TournamentRow | null;
  if (!t || t.cutComputedAt) return; // already done or missing

  // Claim the cut so concurrent readers don't double-run it.
  const claim = await prisma.tournament.updateMany({
    where: { id: tournamentId, cutComputedAt: null },
    data: { cutComputedAt: new Date() },
  });
  if (claim.count === 0) return; // someone else claimed it

  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId },
    select: {
      id: true,
      rounds: {
        where: { tournamentRoundNo: { lte: PRE_CUT_ROUNDS }, completed: true },
        select: { relativeToPar: true, tournamentRoundNo: true },
      },
    },
  });

  const candidates: CutCandidate[] = entries.map((e) => ({
    entryId: e.id,
    completedPreCutRounds: e.rounds.length,
    cumulativeToPar: e.rounds.reduce((s, r) => s + r.relativeToPar, 0),
  }));

  const { advance, withdraw } = computeCut(candidates, t.cutPercent, t.cutMin);

  // Persist results. madeCut true/false for those who completed; withdrawn true
  // for the rest.
  await Promise.all([
    ...[...advance].map((entryId) =>
      prisma.tournamentEntry.update({ where: { id: entryId }, data: { madeCut: true } })
    ),
    ...candidates
      .filter((c) => !advance.has(c.entryId) && !withdraw.has(c.entryId))
      .map((c) => prisma.tournamentEntry.update({ where: { id: c.entryId }, data: { madeCut: false } })),
    ...[...withdraw].map((entryId) =>
      prisma.tournamentEntry.update({ where: { id: entryId }, data: { withdrawn: true, madeCut: false } })
    ),
  ]);
}

// --- winner resolution (lazy, idempotent) ----------------------------------

export interface ChampionResult {
  userId: string;
  username: string;
  cumulativeToPar: number;
  totalDurationMs: number;
}

/**
 * Settle the tournament winner once, after endsAt. Winner = lowest cumulative
 * to-par among CUT-MAKERS who completed all 4 rounds; ties broken by lowest
 * total play time (sum of the 4 rounds' durationMs). Awards the
 * "tournament-champion" special trophy to the winner. Idempotent via a claim on
 * winnerUserId (like runCut's cutComputedAt claim) — safe on concurrent reads.
 * Returns the champion (or null if no eligible finisher).
 */
export async function settleTournament(tournamentId: string): Promise<void> {
  const t = (await prisma.tournament.findUnique({ where: { id: tournamentId } })) as TournamentRow | null;
  if (!t || t.winnerUserId) return; // already settled or missing

  // Claim the settle so concurrent readers don't double-run it. We claim by
  // setting status to "complete" AND requiring winnerUserId still null; but we
  // set winnerUserId in the same update only after computing, so use a separate
  // guard column pattern: attempt to mark a sentinel, then compute.
  // Simpler: compute first, then updateMany guarded on winnerUserId null.

  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId, madeCut: true, withdrawn: false },
    select: {
      userId: true,
      user: { select: { username: true } },
      rounds: {
        where: { tournamentRoundNo: { not: null }, completed: true },
        select: { relativeToPar: true, durationMs: true, tournamentRoundNo: true },
      },
    },
  });

  // Eligible = made cut AND completed all 4 rounds.
  const finishers = entries
    .filter((e) => {
      const nums = new Set(e.rounds.map((r) => r.tournamentRoundNo));
      return [1, 2, 3, 4].every((n) => nums.has(n));
    })
    .map((e) => ({
      userId: e.userId,
      username: e.user.username,
      cumulativeToPar: e.rounds.reduce((s, r) => s + r.relativeToPar, 0),
      totalDurationMs: e.rounds.reduce((s, r) => s + (r.durationMs ?? 0), 0),
    }));

  if (finishers.length === 0) {
    // No eligible finisher — mark complete with no winner so we don't re-run.
    await prisma.tournament.updateMany({
      where: { id: tournamentId, winnerUserId: null },
      data: { status: "complete", winnerUserId: "" },
    });
    return;
  }

  // Rank: lowest to-par, then lowest total time.
  finishers.sort((a, b) => {
    if (a.cumulativeToPar !== b.cumulativeToPar) return a.cumulativeToPar - b.cumulativeToPar;
    return a.totalDurationMs - b.totalDurationMs;
  });
  const champion = finishers[0];

  // Claim: only the first writer (winnerUserId still null) proceeds to award.
  const claim = await prisma.tournament.updateMany({
    where: { id: tournamentId, winnerUserId: null },
    data: { winnerUserId: champion.userId, status: "complete" },
  });
  if (claim.count === 0) return; // someone else settled it

  // Award the champion trophy (idempotent via @@unique([userId, trophyId])).
  await prisma.trophyAward.createMany({
    data: [{ userId: champion.userId, trophyId: "tournament-champion", unlockedAt: new Date() }],
    skipDuplicates: true,
  });
}

/** Called by the finish route for tournament rounds. No streak/trophies/HoF —
 * just leaves the completed round; standings/cut derive from completed rounds.
 * (Kept as a hook for symmetry with challenges + future per-round settling.) */
export async function settleTournamentRound(_roundId: string): Promise<void> {
  // No-op for now: cumulative scoring + cut are derived from completed rounds on
  // read. Placeholder so the finish route has a clear tournament branch and we
  // can add per-round side effects later without touching the route again.
  return;
}

// --- current cutline (live during rounds 1-2) ------------------------------

/**
 * The current cut-line SCORE: among players who've completed both pre-cut rounds
 * so far, the cumulative to-par at the cut position (top cutPercent%, min cutMin,
 * ties extend). Returns null if nobody's completed both rounds yet. This is the
 * "cut line so far" — honest to the moment, not a prediction.
 */
export async function computeCurrentCutline(
  tournamentId: string,
  cutPercent: number,
  cutMin: number
): Promise<number | null> {
  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId, withdrawn: false },
    select: {
      rounds: {
        where: { tournamentRoundNo: { lte: PRE_CUT_ROUNDS }, completed: true },
        select: { relativeToPar: true, tournamentRoundNo: true },
      },
    },
  });

  // Only players through BOTH pre-cut rounds count toward the current line.
  const scores = entries
    .filter((e) => {
      const nums = new Set(e.rounds.map((r) => r.tournamentRoundNo));
      return [1, 2].every((n) => nums.has(n));
    })
    .map((e) => e.rounds.reduce((s, r) => s + r.relativeToPar, 0))
    .sort((a, b) => a - b); // lower (better) first

  return cutlineScore(scores, cutPercent, cutMin);
}

// --- standings (ranked board) ----------------------------------------------

export interface StandingRow {
  entryId: string;
  username: string;
  imageUrl: string | null;
  cumulativeToPar: number;
  roundsComplete: number;
  madeCut: boolean | null;
  withdrawn: boolean;
  isMe: boolean;
}

/**
 * The tournament standings, ranked by cumulative to-par (lower better) over all
 * completed rounds. Withdrawn entries sink to the bottom. `meId` highlights the
 * viewer's row. Derived entirely from completed rounds — no separate score store.
 */
export async function standings(
  tournamentId: string,
  _par: number,
  meId?: string
): Promise<StandingRow[]> {
  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId },
    select: {
      id: true,
      userId: true,
      madeCut: true,
      withdrawn: true,
      user: { select: { username: true, imageUrl: true } },
      rounds: {
        where: { completed: true, tournamentRoundNo: { not: null } },
        select: { relativeToPar: true },
      },
    },
  });

  const rows: StandingRow[] = entries.map((e) => ({
    entryId: e.id,
    username: e.user.username,
    imageUrl: e.user.imageUrl,
    cumulativeToPar: e.rounds.reduce((s, r) => s + r.relativeToPar, 0),
    roundsComplete: e.rounds.length,
    madeCut: e.madeCut,
    withdrawn: e.withdrawn,
    isMe: !!meId && e.userId === meId,
  }));

  // Sort: non-withdrawn first, then by cumulative to-par (lower better), then by
  // more rounds complete (further along ranks higher on a tie).
  rows.sort((a, b) => {
    if (a.withdrawn !== b.withdrawn) return a.withdrawn ? 1 : -1;
    if (a.cumulativeToPar !== b.cumulativeToPar) return a.cumulativeToPar - b.cumulativeToPar;
    return b.roundsComplete - a.roundsComplete;
  });

  return rows;
}

export interface MyRoundProgress {
  roundNo: number;
  completed: boolean;
  relativeToPar: number | null;
  playable: boolean; // open in the current phase (and cut-eligible)
}

export interface MyTournamentProgress {
  joined: boolean;
  madeCut: boolean | null;
  withdrawn: boolean;
  cumulativeToPar: number; // sum of completed rounds
  rounds: MyRoundProgress[]; // rounds 1..4
}

/** My progress in the current tournament — completed rounds, cumulative to-par,
 * which rounds are playable now. Used for the play-page header and the
 * tournament page. Returns joined:false if I haven't entered. */
export async function myTournamentProgress(
  userId: string,
  now = new Date(),
  viewerUsername?: string | null
): Promise<{ tournament: TournamentView; me: MyTournamentProgress } | null> {
  const view = await getActiveTournament(now, viewerUsername);
  if (!view) return null;

  const entry = await prisma.tournamentEntry.findUnique({
    where: { tournamentId_userId: { tournamentId: view.id, userId } },
    select: {
      madeCut: true,
      withdrawn: true,
      rounds: {
        where: { tournamentRoundNo: { not: null } },
        select: { tournamentRoundNo: true, completed: true, relativeToPar: true },
      },
    },
  });

  const open = new Set(view.playableRounds);
  const byNo = new Map<number, { completed: boolean; relativeToPar: number }>();
  for (const r of entry?.rounds ?? []) {
    if (r.tournamentRoundNo != null) byNo.set(r.tournamentRoundNo, { completed: r.completed, relativeToPar: r.relativeToPar });
  }

  const rounds: MyRoundProgress[] = [1, 2, 3, 4].map((n) => {
    const r = byNo.get(n);
    // rounds 3-4 also require having made the cut
    const cutOk = n <= PRE_CUT_ROUNDS || entry?.madeCut === true;
    return {
      roundNo: n,
      completed: !!r?.completed,
      relativeToPar: r?.completed ? r!.relativeToPar : null,
      playable: open.has(n) && cutOk && !(r?.completed),
    };
  });

  const cumulativeToPar = rounds.reduce((s, r) => s + (r.relativeToPar ?? 0), 0);

  return {
    tournament: view,
    me: {
      joined: !!entry,
      madeCut: entry?.madeCut ?? null,
      withdrawn: entry?.withdrawn ?? false,
      cumulativeToPar,
      rounds,
    },
  };
}
