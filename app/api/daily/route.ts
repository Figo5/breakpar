import { NextResponse } from "next/server";
import { dailyCourse, puzzleNumber, dateKey } from "@/lib/daily";
import { coursePar } from "@/data/courses";

// Public: today's course + holes. Cached per day at the edge.
export const revalidate = 300;

export async function GET() {
  const course = dailyCourse();
  return NextResponse.json({
    puzzleNumber: puzzleNumber(),
    dateKey: dateKey(),
    course: {
      slug: course.slug,
      name: course.name,
      location: course.location,
      difficulty: course.difficulty,
      wind: course.wind,
      windDir: course.windDir,
      greens: course.greens,
      par: coursePar(course),
      holes: course.holes, // par/yardage/strokeIndex — safe to expose
    },
  });
}
