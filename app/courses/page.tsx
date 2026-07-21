import Link from "next/link";
import { COURSES, coursePar } from "@/data/courses";
import { getCurrentUser } from "@/lib/user";
import { bestRoundsBySlug } from "@/lib/bestRounds";
import { playCountsBySlug } from "@/lib/coursePopularity";
import { regionOf, characterOf, courseYardage } from "@/lib/courseFacets";
import { CourseBrowser, type CourseRow } from "./CourseBrowser";

// Unlimited practice: pick any course and play as many rounds as you like.
export default async function Courses() {
  // Read-only page: resolve the viewer WITHOUT minting a guest. A signed-out
  // visitor simply sees no personal bests (and no played/unplayed filter).
  const user = await getCurrentUser();
  const [best, plays] = await Promise.all([
    user ? bestRoundsBySlug(user.id) : Promise.resolve({} as Record<string, number>),
    playCountsBySlug(),
  ]);

  // Flatten to plain rows here so the client island never imports the course
  // catalogue and never re-derives facets — it just filters an array it's given.
  const rows: CourseRow[] = COURSES.map((c) => ({
    slug: c.slug,
    name: c.name,
    location: c.location,
    blurb: c.blurb,
    par: coursePar(c),
    yardage: courseYardage(c),
    difficulty: c.difficulty,
    wind: c.wind,
    greens: c.greens,
    region: regionOf(c.location),
    character: characterOf(c),
    plays: plays[c.slug] ?? 0,
    best: best[c.slug],
  }));

  return (
    <div className="screen">
      <div className="eyebrow">Unlimited Practice</div>
      <div className="wordmark" style={{ fontSize: "clamp(40px,12vw,56px)" }}>
        Courses
      </div>
      <div className="tagline">Play any course, as many times as you want. Practice rounds don&apos;t affect your daily streak.</div>

      <CourseBrowser courses={rows} signedIn={!!user} />

      <div className="btn-stack" style={{ marginTop: 18 }}>
        <Link href="/" className="cta ghost">Back to today</Link>
      </div>
    </div>
  );
}
