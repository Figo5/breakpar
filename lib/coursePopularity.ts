import { prisma } from "@/lib/db";

/**
 * How many completed rounds each course has, keyed by slug. Drives the default
 * "most played" ordering and the play-count chip on /courses.
 *
 * Counts every completed round regardless of mode, mirroring bestRoundsBySlug:
 * a round played is a round played, whether it came from practice, a daily, a
 * tournament or a challenge. Incomplete rounds don't count — an abandoned round
 * isn't evidence anyone wanted to play that course.
 *
 * One groupBy plus one id->slug lookup, the same shape as bestRoundsBySlug, so
 * this stays cheap enough to run on every /courses render.
 */
export async function playCountsBySlug(): Promise<Record<string, number>> {
  const rows = await prisma.round.groupBy({
    by: ["courseId"],
    where: { completed: true },
    _count: { _all: true },
  });
  if (rows.length === 0) return {};

  type Row = { courseId: string; _count: { _all: number } };
  const typed = rows as Row[];

  const courses = await prisma.course.findMany({
    where: { id: { in: typed.map((r) => r.courseId) } },
    select: { id: true, slug: true },
  });
  const slugById = new Map<string, string>(
    (courses as { id: string; slug: string }[]).map((c) => [c.id, c.slug])
  );

  const out: Record<string, number> = {};
  for (const r of typed) {
    const slug = slugById.get(r.courseId);
    if (slug) out[slug] = r._count._all;
  }
  return out;
}
