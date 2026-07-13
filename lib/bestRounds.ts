import { prisma } from "@/lib/db";

/**
 * The viewer's personal-best (lowest relativeToPar) COMPLETED round on each
 * course, keyed by course slug. Used on the course-select grid so a player can
 * see their low round on a course before picking it (admin request, Jul 10).
 *
 * Counts every completed round regardless of mode — a low round is a low round
 * whether it came from practice, a daily, a tournament, or a challenge. Groups
 * in the database (one query, min aggregate) rather than pulling rows.
 */
export async function bestRoundsBySlug(userId: string): Promise<Record<string, number>> {
  const rows = await prisma.round.groupBy({
    by: ["courseId"],
    where: { userId, completed: true },
    _min: { relativeToPar: true },
  });
  if (rows.length === 0) return {};

  type Row = { courseId: string; _min: { relativeToPar: number | null } };
  const typed = rows as Row[];

  // Map courseId -> slug in one lookup.
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
    if (slug && r._min.relativeToPar !== null) out[slug] = r._min.relativeToPar;
  }
  return out;
}

/** Format a to-par number the way the rest of the UI does: E, -3, +5. */
export function toParLabel(rel: number): string {
  return rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`;
}
