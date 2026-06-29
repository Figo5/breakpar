import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getOrStartUser, GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from "@/lib/user";
import { dailyCourse, dateKey, puzzleNumberForKey } from "@/lib/daily";
import { coursePar, courseBySlug, type Course } from "@/data/courses";
import { AGGRESSIVE_BUDGET } from "@/lib/holeRead";
import { countTeeApproachAggressive } from "@/lib/engine/shots";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";

/** Shape a Course for the client (used by the play screen). */
function coursePayload(course: Course) {
  return {
    slug: course.slug,
    name: course.name,
    location: course.location,
    difficulty: course.difficulty,
    wind: course.wind,
    windDir: course.windDir,
    greens: course.greens,
    blurb: course.blurb,
    par: coursePar(course),
    holes: course.holes,
  };
}

// POST: start/resume a round.
//   - no body            -> today's ranked daily round (one per day, resumes)
//   - { slug }           -> a fresh unlimited (practice) round on that course
// No sign-in required: an anonymous guest identity is minted on first play.
export const POST = route(async (req: Request) => {
  const limited = await rateLimit("round-start", 30, 60_000); // 30/min
  if (limited) return limited;

  const { user, newGuestId } = await getOrStartUser();

  const body = (await req.json().catch(() => ({}))) as { slug?: string };
  const unlimited = typeof body.slug === "string" && body.slug.length > 0;
  const course = unlimited ? courseBySlug(body.slug!) : dailyCourse();
  if (!course) return NextResponse.json({ error: "unknown-course" }, { status: 404 });

  // Course rows are seeded; look up the id by slug.
  const courseRow = await prisma.course.findUnique({ where: { slug: course.slug } });
  if (!courseRow)
    return NextResponse.json({ error: "course-not-seeded" }, { status: 500 });

  let round;
  if (unlimited) {
    // Unlimited rounds are never resumed — each start is a fresh card.
    round = await prisma.round.create({
      data: { userId: user.id, courseId: courseRow.id, mode: "unlimited", dateKey: null },
      include: { holeResults: true, course: { select: { slug: true } } },
    });
  } else {
    const key = dateKey();
    try {
      // One ranked round per day — resume if it already exists.
      round = await prisma.round.upsert({
        where: { userId_dateKey: { userId: user.id, dateKey: key } },
        update: {},
        create: { userId: user.id, courseId: courseRow.id, mode: "daily", dateKey: key },
        include: { holeResults: true, course: { select: { slug: true } } },
      });
    } catch (e) {
      // Concurrent first-start race: two upserts both tried to create. The
      // unique(userId, dateKey) rejects the loser — just read the winner's row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        round = await prisma.round.findUniqueOrThrow({
          where: { userId_dateKey: { userId: user.id, dateKey: key } },
          include: { holeResults: true, course: { select: { slug: true } } },
        });
      } else {
        throw e;
      }
    }
  }

  // Resolve the round's OWN stored course, not the freshly-computed one. On a
  // RESUME the daily schedule may have moved since the round was created (a
  // round straddling UTC midnight, or a catalogue change), so the recomputed
  // dailyCourse() can disagree with what this round was actually played on.
  // The hole route and result page already key off the stored course; this
  // keeps start/resume consistent. For a fresh round this equals `course`.
  const playedCourse = courseBySlug(round.course.slug) ?? course;

  const res = NextResponse.json({
    roundId: round.id,
    mode: round.mode,
    completed: round.completed,
    playedHoles: round.holeResults.map((h) => h.holeNumber),
    // Only tee/approach aggressive plays count against the budget — putt and
    // short-game "Charge" decisions reuse the vocab but are never charged.
    aggressiveUsed: round.holeResults.reduce(
      (n, h) =>
        n +
        countTeeApproachAggressive(
          h.decision,
          playedCourse.holes.find((ch) => ch.number === h.holeNumber)?.par ?? 4
        ),
      0
    ),
    aggressiveBudget: AGGRESSIVE_BUDGET,
    score: round.score,
    relativeToPar: round.relativeToPar,
    // Derive the puzzle number from the round's persisted dateKey (not wall
    // clock) so a resume across midnight stays on its original puzzle.
    puzzleNumber: round.dateKey ? puzzleNumberForKey(round.dateKey) : null,
    course: coursePayload(playedCourse),
  });

  // Persist a freshly-minted guest identity so subsequent requests resolve it.
  if (newGuestId) {
    res.cookies.set(GUEST_COOKIE, newGuestId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_COOKIE_MAX_AGE,
    });
  }
  return res;
});
