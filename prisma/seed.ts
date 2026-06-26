// Seed the Course + Hole tables from the static catalogue.
import { PrismaClient } from "@prisma/client";
import { COURSES } from "../data/courses";

const prisma = new PrismaClient();

async function main() {
  for (const c of COURSES) {
    const course = await prisma.course.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name, location: c.location, rating: c.rating,
        slope: c.slope, difficulty: c.difficulty, wind: c.wind, greens: c.greens,
      },
      create: {
        slug: c.slug, name: c.name, location: c.location, rating: c.rating,
        slope: c.slope, difficulty: c.difficulty, wind: c.wind, greens: c.greens,
      },
    });
    for (const h of c.holes) {
      await prisma.hole.upsert({
        where: { courseId_holeNumber: { courseId: course.id, holeNumber: h.number } },
        update: { par: h.par, yardage: h.yardage, strokeIndex: h.strokeIndex },
        create: {
          courseId: course.id, holeNumber: h.number,
          par: h.par, yardage: h.yardage, strokeIndex: h.strokeIndex,
        },
      });
    }
    console.log(`seeded ${c.name}`);
  }
}
main().finally(() => prisma.$disconnect());
