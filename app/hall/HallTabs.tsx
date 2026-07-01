"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { relativeLabel } from "@/lib/scoring";
import type { CourseRecord } from "@/lib/hallOfFame";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  TIER_META,
  type TrophyBoard,
  type TrophyState,
  type TrophyCategory,
} from "@/lib/trophies";

/**
 * Client toggle for the Hall of Fame: [ Course Records ] [ Trophies ]. Both
 * datasets are fetched server-side and passed in, so switching is instant with
 * no refetch. Nothing here writes; it only chooses which section renders.
 */
export function HallTabs({
  records,
  coursesPlayed,
  coursesTotal,
  recordsUnderPar,
  bestOverall,
  trophies,
}: {
  records: CourseRecord[];
  coursesPlayed: number;
  coursesTotal: number;
  recordsUnderPar: number;
  bestOverall: number | null;
  trophies: TrophyBoard | null;
}) {
  const [tab, setTab] = useState<"records" | "trophies">("records");

  return (
    <>
      <div className="hall-toggle" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "records"}
          className={`hall-tab ${tab === "records" ? "on" : ""}`}
          onClick={() => setTab("records")}
        >
          Course Records
        </button>
        <button
          role="tab"
          aria-selected={tab === "trophies"}
          className={`hall-tab ${tab === "trophies" ? "on" : ""}`}
          onClick={() => setTab("trophies")}
        >
          Trophies{trophies ? ` ${trophies.earnedCount}/${trophies.totalCount}` : ""}
        </button>
      </div>

      {tab === "records" ? (
        <>
          <div className="start-stats">
            <div className="stat-card">
              <div className="n">{coursesPlayed}<span style={{ fontSize: 14, opacity: 0.6 }}>/{coursesTotal}</span></div>
              <div className="k">Courses conquered</div>
            </div>
            <div className="stat-card">
              <div className="n">{recordsUnderPar || "—"}</div>
              <div className="k">Records under par</div>
            </div>
            <div className="stat-card">
              <div className="n">{bestOverall !== null ? relativeLabel(bestOverall) : "—"}</div>
              <div className="k">Best card</div>
            </div>
          </div>
          <div className="section-title">Course Records</div>
          <div className="lb">
            {records.map((r) => (
              <RecordRow key={r.slug} r={r} />
            ))}
          </div>
        </>
      ) : (
        <TrophyCase trophies={trophies} />
      )}
    </>
  );
}

function RecordRow({ r }: { r: CourseRecord }) {
  if (r.played) {
    const tag = r.mode === "daily" ? (r.puzzleNo ? `#${r.puzzleNo}` : "Daily") : "Practice";
    const badge = r.relativeToPar! < 0 ? "🏆" : "";
    return (
      <Link href={`/result/${r.roundId}`} className="lb-row prow">
        <span className="rank">{badge}</span>
        <span className="nm">
          {r.courseName}
          <span className="prow-tag">{tag}</span>
        </span>
        <span className="tm">Par {r.par}</span>
        <span className="sc">{relativeLabel(r.relativeToPar!)}</span>
      </Link>
    );
  }
  return (
    <Link href={`/play?course=${r.slug}`} className="lb-row prow" style={{ opacity: 0.72 }}>
      <span className="rank">＋</span>
      <span className="nm">
        {r.courseName}
        <span className="prow-tag">Open</span>
      </span>
      <span className="tm">Par {r.par}</span>
      <span className="sc" style={{ fontSize: 12, color: "var(--ink-soft)" }}>Play</span>
    </Link>
  );
}

function TrophyCase({ trophies }: { trophies: TrophyBoard | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(trophies?.featured ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  if (!trophies) {
    return (
      <div className="profile-empty">
        No trophies yet. Play a round and they start filling in.
      </div>
    );
  }

  const byCat = (cat: TrophyCategory) => trophies.states.filter((s) => s.category === cat);

  // Toggle a trophy in/out of the featured selection (max 5, preserve order).
  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 5 ? cur : [...cur, id]
    );

  async function save() {
    if (saving) return;
    setSaving(true);
    setErr(false);
    try {
      const res = await fetch("/api/profile/featured", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trophyIds: selected }),
      });
      if (!res.ok) throw new Error("featured");
      setEditing(false);
      router.refresh();
    } catch {
      setErr(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="trophy-summary">
        <strong>{trophies.earnedCount}</strong> of {trophies.totalCount} earned
        {trophies.earnedCount > 0 && (
          <span className="trophy-tally">
            {(["legendary", "elite", "rare", "common"] as const)
              .filter((t) => trophies.tierTally[t] > 0)
              .map((t) => `${trophies.tierTally[t]} ${TIER_META[t].label}`)
              .join(" · ")}
          </span>
        )}
      </div>

      {trophies.earnedCount > 0 && (
        <div className="featured-edit">
          {editing ? (
            <>
              <span className="fe-count">Pick up to 5 · {selected.length}/5 chosen</span>
              <div className="fe-actions">
                <button className="cta ghost fe-btn" onClick={() => { setSelected(trophies.featured); setEditing(false); setErr(false); }} disabled={saving}>Cancel</button>
                <button className="cta fe-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save featured"}</button>
              </div>
            </>
          ) : (
            <button className="cta ghost fe-btn" onClick={() => setEditing(true)}>⭐ Edit featured</button>
          )}
          {err && <div className="fb-err">Couldn&apos;t save. Try again.</div>}
        </div>
      )}

      {CATEGORY_ORDER.map((cat) => {
        // Special/manual badges only appear once actually awarded — no locked
        // "Creator" tile for everyone.
        const items = cat === "special" ? byCat(cat).filter((s) => s.earned) : byCat(cat);
        if (items.length === 0) return null;
        // earned first, then by tier rank descending (rarer goals first)
        const sorted = [...items].sort(
          (a, b) =>
            Number(b.earned) - Number(a.earned) ||
            TIER_META[a.tier].rank - TIER_META[b.tier].rank
        );
        return (
          <div key={cat}>
            <div className="section-title">
              {CATEGORY_META[cat].emoji} {CATEGORY_META[cat].label}
            </div>
            <div className="trophy-grid">
              {sorted.map((t) => (
                <TrophyTile
                  key={t.id}
                  t={t}
                  editing={editing}
                  featuredRank={selected.indexOf(t.id)}
                  onToggle={() => toggle(t.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function TrophyTile({
  t,
  editing = false,
  featuredRank = -1,
  onToggle,
}: {
  t: TrophyState;
  editing?: boolean;
  featuredRank?: number;
  onToggle?: () => void;
}) {
  const selectable = editing && t.earned;
  const isFeatured = featuredRank >= 0;
  const cls =
    (t.comingSoon ? "trophy soon" : t.earned ? `trophy earned t-${t.tier}` : "trophy locked") +
    (selectable ? " selectable" : "") +
    (isFeatured ? " featured-pick" : "");

  const inner = (
    <>
      <div className="trophy-badge">{t.earned ? TIER_ICON[t.tier] : "🔒"}</div>
      {isFeatured && <span className="fe-rank">{featuredRank + 1}</span>}
      {!editing && isFeatured && <span className="fe-star" title="Featured">⭐</span>}
      <div className="trophy-name">{t.label}</div>
      {t.comingSoon ? (
        <div className="trophy-crit">{t.criteria}</div>
      ) : t.earned ? (
        <>
          <div className="trophy-tier-label">{t.special ? "Special · Awarded" : TIER_META[t.tier].label}</div>
          {t.unlockedAt && (
            <div className="trophy-date">
              {new Date(t.unlockedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="trophy-crit">{t.criteria}</div>
          <div className="trophy-bar">
            <i style={{ width: `${t.progressPct}%` }} />
          </div>
          <div className="trophy-prog">
            {t.current}/{t.target} · {t.progressPct}%
          </div>
        </>
      )}
    </>
  );

  // In edit mode, earned tiles become selectable buttons; otherwise a plain tile.
  return selectable ? (
    <button type="button" className={cls} aria-pressed={isFeatured} onClick={onToggle}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

const TIER_ICON: Record<TrophyState["tier"], string> = {
  common: "🎖️",
  rare: "🏅",
  elite: "🏆",
  legendary: "👑",
  special: "✦",
};
