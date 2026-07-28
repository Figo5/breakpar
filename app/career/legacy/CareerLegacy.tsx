"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { CareerLegacyView } from "@/lib/career/legacy";
import { CareerChrome, CareerError, CareerLoading } from "../CareerChrome";

export function CareerLegacy() {
  const searchParams = useSearchParams();
  const profileId = searchParams.get("profileId");
  const [view, setView] = useState<CareerLegacyView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const query = profileId
        ? `?profileId=${encodeURIComponent(profileId)}`
        : "";
      const response = await fetch(`/api/career/legacy${query}`, { cache: "no-store" });
      if (response.status === 404) throw new Error("You haven't started a career yet.");
      if (!response.ok) throw new Error("Your Legacy record is temporarily unavailable.");
      setView(await response.json() as CareerLegacyView);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) {
    return (
      <CareerChrome eyebrow="Legacy">
        {error ? <CareerError message={error} retry={() => void load()} /> : <CareerLoading label="Opening your record…" />}
      </CareerChrome>
    );
  }

  const { title } = view;

  return (
    <CareerChrome eyebrow="Legacy">
      <div className="career-season-hero">
        <div className="career-kicker">{title.title}</div>
        <h1>{view.legacyTotal.toLocaleString()}</h1>
        <p>Legacy points — permanent, and they never decrease.</p>
      </div>

      <details className="career-legacy-breakdown">
        <summary>
          <span>
            <b>{view.legacyTotal.toLocaleString()} Legacy Points</b>
          </span>
          <strong>View breakdown</strong>
        </summary>
        <div className="career-legacy-breakdown-body">
          <div className="career-legacy-next">
            {title.nextTitle ? (
              <>
                <div className="career-legacy-next-line">
                  <span>Next: {title.nextTitle}</span>
                  <strong>{title.nextThreshold?.toLocaleString()}</strong>
                </div>
                <div
                  className="career-legacy-bar"
                  role="progressbar"
                  aria-valuenow={view.legacyTotal}
                  aria-valuemin={title.earnedAt}
                  aria-valuemax={title.nextThreshold ?? view.legacyTotal}
                >
                  <i style={{ width: `${Math.round(title.progress * 100)}%` }} />
                </div>
                <small>{title.pointsToNext?.toLocaleString()} points to go</small>
              </>
            ) : (
              <small>Highest title reached: {title.title}</small>
            )}
          </div>

          {!view.reconciles || !view.groupingReconciles ? (
            <div className="career-context">
              <b>Legacy totals need review</b>
              Stored total {view.legacyTotal.toLocaleString()} · ledger{" "}
              {view.ledgerTotal.toLocaleString()} · grouped seasons{" "}
              {view.groupedTotal.toLocaleString()}.
            </div>
          ) : null}

          {view.invariantViolations.length > 0 && (
            <div className="career-context">
              <b>Unexpected ledger rows</b>
              {view.invariantViolations.map((violation) => (
                <span key={violation}>{violation}</span>
              ))}
            </div>
          )}

          {view.seasons.length === 0 ? (
            <div className="career-empty">
              <b>No Legacy points yet.</b>
              <span>Complete your first Career event to start the record.</span>
            </div>
          ) : (
            <div className="career-legacy-seasons">
              {view.seasons.map((season) => (
                <details key={season.seasonNumber}>
                  <summary>
                    <span>
                      <b>Season {season.seasonNumber}</b>
                      <small>{season.tier.charAt(0)}{season.tier.slice(1).toLowerCase()} Tour</small>
                    </span>
                    <span className="career-legacy-indicators">
                      {season.indicators.includes("promotion") && <i title="Promotion">↑</i>}
                      {season.indicators.includes("championship") && <i title="Championship">◆</i>}
                      {season.indicators.includes("trophy") && <i title="Trophy">★</i>}
                    </span>
                    <strong>+{season.points}</strong>
                  </summary>
                  <div>
                    {season.categories.map((category) => (
                      <p key={category.awardType}>
                        <span>{category.label}{category.count > 1 ? ` ×${category.count}` : ""}</span>
                        <b>+{category.points}</b>
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </details>

      <div className="career-context good">
        <b>Legacy is permanent and never decreases</b>
        A relegation or skipped Championship can never take points away. Each
        season above is backed by the immutable award ledger.
      </div>

      <div className="career-links">
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </div>
    </CareerChrome>
  );
}
