import Link from "next/link";
import { CHANGELOG } from "@/data/changelog";

// Static changelog. Entries live in data/changelog.ts — add to the top of that
// array when shipping. Dry and factual on purpose: what changed, nothing else.
export const metadata = {
  title: "Changelog · Break Par",
  description: "What's new in Break Par.",
};

/** "2026-07-09" -> "Jul 9, 2026". Parsed as UTC so the date never shifts by zone. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ChangelogPage() {
  return (
    <div className="screen hiw">
      <div className="topbar">
        <div className="eyebrow">Break Par</div>
        <Link href="/" className="acct-link">Back to today</Link>
      </div>

      <h1 className="wordmark" style={{ fontSize: "clamp(40px,12vw,56px)" }}>
        CHANGE<span>LOG</span>
      </h1>
      <p className="tagline">What&apos;s new, newest first.</p>

      <div className="chg-list">
        {CHANGELOG.map((entry) => (
          <section className="chg-entry" key={entry.date}>
            <h2 className="chg-date">
              <time dateTime={entry.date}>{formatDate(entry.date)}</time>
            </h2>
            <ul className="chg-items">
              {entry.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="hiw-cta" style={{ textAlign: "center" }}>
        <Link href="/" className="cta">Play today&apos;s round</Link>
      </div>

      <div className="footnote">
        Course names are trademarks of their owners; Break Par is unaffiliated and
        layouts/yardages are stylized for play.
      </div>
    </div>
  );
}
