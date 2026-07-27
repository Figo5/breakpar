"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CareerLegacyView } from "@/lib/career/legacy";
import { CareerChrome, CareerError, CareerLoading } from "../CareerChrome";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

export function CareerLegacy() {
  const [view, setView] = useState<CareerLegacyView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/career/legacy", { cache: "no-store" });
      if (response.status === 404) throw new Error("You haven't started a career yet.");
      if (!response.ok) throw new Error("Your Legacy record is temporarily unavailable.");
      setView(await response.json() as CareerLegacyView);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    }
  }, []);

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
          <>
            <div className="career-legacy-next-line">
              <span>Highest title reached</span>
              <strong>{title.title}</strong>
            </div>
            <small>There is no ladder above this one. Keep adding to the record.</small>
          </>
        )}
      </div>

      {!view.reconciles && (
        <div className="career-context">
          <b>Ledger and total disagree</b>
          The ledger below sums to {view.ledgerTotal.toLocaleString()}, while your
          profile shows {view.legacyTotal.toLocaleString()}. The ledger rows are the
          record of what you earned; nothing has been altered to hide the difference.
        </div>
      )}

      {view.invariantViolations.length > 0 && (
        <div className="career-context">
          <b>Unexpected ledger rows</b>
          {view.invariantViolations.map((violation) => (
            <span key={violation}>{violation}</span>
          ))}
        </div>
      )}

      <div className="career-section-head">
        <div>
          <span>Every award</span>
          <b>{view.entries.length} entr{view.entries.length === 1 ? "y" : "ies"}</b>
        </div>
      </div>

      {view.entries.length === 0 ? (
        <div className="career-empty">
          <b>No Legacy points yet.</b>
          <span>
            Complete your first Career event and the award lands here, permanently.
          </span>
          <Link href="/career" className="cta ghost">Back to my career</Link>
        </div>
      ) : (
        <ol className="career-ledger">
          {view.entries.map((entry) => (
            <li key={entry.id}>
              <div className="career-ledger-head">
                <b>{entry.label}</b>
                <strong>+{entry.points}</strong>
              </div>
              <p>{entry.reason}</p>
              <div className="career-ledger-meta">
                <span>{entry.context ?? "Career"}</span>
                <span>{new Date(entry.earnedAt).toLocaleDateString(undefined, DATE_FORMAT)}</span>
                <span>Balance {entry.runningTotal.toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="career-context good">
        <b>Legacy is permanent and never decreases</b>
        A missed season, a relegation, or a Championship you skip can never take
        points away. Every entry above is the record of something you did, and it
        stays on the ledger for as long as your career exists.
      </div>

      <div className="career-links">
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </div>
    </CareerChrome>
  );
}
