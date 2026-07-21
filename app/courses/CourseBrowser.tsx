"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  REGION_META, REGION_ORDER, CHARACTER_META, CHARACTER_ORDER,
  type Region, type Character, type SortKey,
} from "@/lib/courseFacets";

/**
 * Client island for /courses: filter + sort over the whole roster.
 *
 * The server hands down an already-flattened row per course (facets derived,
 * play count and personal best attached) so this component never imports the
 * course data or touches prisma — it only filters an array it was given. With
 * ~50 courses that's a few microseconds per keystroke, so filtering is done in
 * memory rather than round-tripping the server for every chip toggle.
 */

export interface CourseRow {
  slug: string;
  name: string;
  location: string;
  blurb: string;
  par: number;
  yardage: number;
  difficulty: number;
  wind: number;
  greens: string;
  region: Region;
  character: Character[];
  plays: number;
  best?: number;
}

const toPar = (rel: number) => (rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`);

/** Difficulty buckets. The roster spans 7-10, so these are the real bands. */
const DIFF_BANDS: { key: string; label: string; test: (d: number) => boolean }[] = [
  { key: "7", label: "7", test: (d) => d === 7 },
  { key: "8", label: "8", test: (d) => d === 8 },
  { key: "9", label: "9", test: (d) => d === 9 },
  { key: "10", label: "10", test: (d) => d === 10 },
];

export function CourseBrowser({ courses, signedIn }: { courses: CourseRow[]; signedIn: boolean }) {
  const [sort, setSort] = useState<SortKey>("popular");
  const [diffs, setDiffs] = useState<Set<string>>(new Set());
  const [regions, setRegions] = useState<Set<Region>>(new Set());
  const [chars, setChars] = useState<Set<Character>>(new Set());
  const [played, setPlayed] = useState<"all" | "played" | "unplayed">("all");

  // Toggle a value in a Set-backed filter (chips are multi-select).
  function toggle<T>(set: Set<T>, value: T, apply: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  const shown = useMemo(() => {
    const out = courses.filter((c) => {
      if (diffs.size && !DIFF_BANDS.some((b) => diffs.has(b.key) && b.test(c.difficulty))) return false;
      if (regions.size && !regions.has(c.region)) return false;
      // Character chips are OR'd: picking Links and Water shows either.
      if (chars.size && !c.character.some((t) => chars.has(t))) return false;
      if (played === "played" && c.best === undefined) return false;
      if (played === "unplayed" && c.best !== undefined) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "difficulty") return b.difficulty - a.difficulty || a.name.localeCompare(b.name);
      if (sort === "name") return a.name.localeCompare(b.name);
      // popular: most-played first, then alphabetical so ties are stable and
      // never-played courses don't shuffle between renders.
      return b.plays - a.plays || a.name.localeCompare(b.name);
    });
    return out;
  }, [courses, diffs, regions, chars, played, sort]);

  const filtersOn = diffs.size + regions.size + chars.size > 0 || played !== "all";

  function clearAll() {
    setDiffs(new Set());
    setRegions(new Set());
    setChars(new Set());
    setPlayed("all");
  }

  return (
    <>
      <div className="cf-bar">
        <div className="cf-row">
          <span className="cf-label">Sort</span>
          {([["popular", "Most played"], ["difficulty", "Hardest"], ["name", "A–Z"]] as [SortKey, string][]).map(
            ([key, label]) => (
              <button
                key={key}
                className={`cf-chip ${sort === key ? "on" : ""}`}
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
              >
                {label}
              </button>
            )
          )}
        </div>

        <div className="cf-row">
          <span className="cf-label">Difficulty</span>
          {DIFF_BANDS.map((b) => (
            <button
              key={b.key}
              className={`cf-chip ${diffs.has(b.key) ? "on" : ""}`}
              onClick={() => toggle(diffs, b.key, setDiffs)}
              aria-pressed={diffs.has(b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="cf-row">
          <span className="cf-label">Style</span>
          {CHARACTER_ORDER.map((t) => (
            <button
              key={t}
              className={`cf-chip ${chars.has(t) ? "on" : ""}`}
              onClick={() => toggle(chars, t, setChars)}
              aria-pressed={chars.has(t)}
              title={CHARACTER_META[t].hint}
            >
              {CHARACTER_META[t].label}
            </button>
          ))}
        </div>

        <div className="cf-row">
          <span className="cf-label">Region</span>
          {REGION_ORDER.map((r) => (
            <button
              key={r}
              className={`cf-chip ${regions.has(r) ? "on" : ""}`}
              onClick={() => toggle(regions, r, setRegions)}
              aria-pressed={regions.has(r)}
            >
              {REGION_META[r].label}
            </button>
          ))}
        </div>

        {signedIn && (
          <div className="cf-row">
            <span className="cf-label">Played</span>
            {([["all", "All"], ["played", "Played"], ["unplayed", "Not yet"]] as const).map(([key, label]) => (
              <button
                key={key}
                className={`cf-chip ${played === key ? "on" : ""}`}
                onClick={() => setPlayed(key)}
                aria-pressed={played === key}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="cf-foot">
          <span className="cf-count">
            {shown.length} of {courses.length} course{courses.length === 1 ? "" : "s"}
          </span>
          {filtersOn && (
            <button className="cf-clear" onClick={clearAll}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="profile-empty">
          No courses match those filters.{" "}
          <button className="cf-clear" onClick={clearAll}>
            Clear them
          </button>
        </div>
      ) : (
        <div className="course-list">
          {shown.map((c) => (
            <Link key={c.slug} href={`/play?course=${c.slug}`} className="course-card">
              <div className="cc-head">
                <h3>{c.name}</h3>
                <span className="cc-par">Par {c.par}</span>
              </div>
              <div className="cc-loc">
                {c.location} · {c.yardage.toLocaleString()} yds
              </div>
              <div className="cc-blurb">{c.blurb}</div>
              <div className="chips" style={{ marginTop: 10 }}>
                <div className="chip">Wind {c.wind}</div>
                <div className="chip">Greens {c.greens}</div>
                <div className="chip">Difficulty {c.difficulty}/10</div>
                {c.plays > 0 && (
                  <div className="chip" title="Completed rounds on this course">
                    {c.plays.toLocaleString()} round{c.plays === 1 ? "" : "s"}
                  </div>
                )}
                {c.best !== undefined ? (
                  <div className="chip cc-best" title="Your low round on this course">
                    Your best {toPar(c.best)}
                  </div>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
