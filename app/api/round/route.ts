import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getOrStartUser, GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from "@/lib/user";
import { dailyCourse, dateKey, puzzleNumber } from "@/lib/daily";
import { coursePar, courseBySlug, type Course } from "@/data/courses";
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
      include: { holeResults: true },
    });
  } else {
    const key = dateKey();
    try {
      // One ranked round per day — resume if it already exists.
      round = await prisma.round.upsert({
        where: { userId_dateKey: { userId: user.id, dateKey: key } },
        update: {},
        create: { userId: user.id, courseId: courseRow.id, mode: "daily", dateKey: key },
        include: { holeResults: true },
      });
    } catch (e) {
      // Concurrent first-start race: two upserts both tried to create. The
      // unique(userId, dateKey) rejects the loser — just read the winner's row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        round = await prisma.round.findUniqueOrThrow({
          where: { userId_dateKey: { userId: user.id, dateKey: key } },
          include: { holeResults: true },
        });
      } else {
        throw e;
      }
    }
  }

  const res = NextResponse.json({
    roundId: round.id,
    mode: round.mode,
    completed: round.completed,
    playedHoles: round.holeResults.map((h) => h.holeNumber),
    score: round.score,
    relativeToPar: round.relativeToPar,
    puzzleNumber: unlimited ? null : puzzleNumber(),
    course: coursePayload(course),
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
