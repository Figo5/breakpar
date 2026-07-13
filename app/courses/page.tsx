import Link from "next/link";
import { COURSES, coursePar } from "@/data/courses";
import { getCurrentUser } from "@/lib/user";
import { bestRoundsBySlug, toParLabel } from "@/lib/bestRounds";

// Unlimited practice: pick any course and play as many rounds as you like.
export default async function Courses() {
  // Read-only page: resolve the viewer WITHOUT minting a guest. A signed-out
  // visitor simply sees no personal bests.
  const user = await getCurrentUser();
  const best = user ? await bestRoundsBySlug(user.id) : {};

  return (
    <div className="screen">
      <div className="eyebrow">Unlimited Practice</div>
      <div className="wordmark" style={{ fontSize: "clamp(40px,12vw,56px)" }}>
        Courses
      </div>
      <div className="tagline">Play any course, as many times as you want. Practice rounds don&apos;t affect your daily streak.</div>

      <div className="course-list">
        {COURSES.map((c) => {
          const low = best[c.slug];
          return (
            <Link key={c.slug} href={`/play?course=${c.slug}`} className="course-card">
              <div className="cc-head">
                <h3>{c.name}</h3>
                <span className="cc-par">Par {coursePar(c)}</span>
              </div>
              <div className="cc-loc">{c.location}</div>
              <div className="cc-blurb">{c.blurb}</div>
              <div className="chips" style={{ marginTop: 10 }}>
                <div className="chip">💨 {c.wind} mph</div>
                <div className="chip">🟢 {c.greens}</div>
                <div className="chip">🎯 {c.difficulty}/10</div>
                {low !== undefined ? (
                  <div className="chip cc-best" title="Your low round on this course">
                    ⛳ Your best {toParLabel(low)}
                  </div>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="btn-stack" style={{ marginTop: 18 }}>
        <Link href="/" className="cta ghost">Back to today</Link>
      </div>
    </div>
  );
}
