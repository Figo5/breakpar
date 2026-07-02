import Link from "next/link";

// Static explainer — "how the game works" / fair play. Addresses the recurring
// "it feels like RNG regardless of my decision" feedback by explaining the
// probability model honestly: decisions shift real odds, but golf has variance,
// so nothing is guaranteed on a single hole — skill shows over a full round.
export const metadata = {
  title: "How Break Par Works",
  description: "How scoring, decisions, and probabilities work in Break Par.",
};

export default function HowItWorksPage() {
  return (
    <div className="screen hiw">
      <div className="topbar">
        <div className="eyebrow">Break Par</div>
        <Link href="/" className="acct-link">Back to today</Link>
      </div>

      <h1 className="wordmark" style={{ fontSize: "clamp(40px,12vw,56px)" }}>
        HOW IT <span>WORKS</span>
      </h1>
      <p className="tagline">Read the hole. Pick your risk. Beat par over 18.</p>

      <section className="hiw-block">
        <h2 className="hiw-h">The goal</h2>
        <p>
          Every day is one real course, 18 holes. You&apos;re trying to finish
          <b> under par</b> — that&apos;s &quot;breaking par.&quot; It&apos;s hard on
          purpose: even smart play breaks par only around <b>30% of the time</b>.
          A good round is usually a couple over, and going under is a genuine
          achievement.
        </p>
      </section>

      <section className="hiw-block">
        <h2 className="hiw-h">Every shot is a decision</h2>
        <p>
          On each shot you choose how much risk to take — <b>Safe</b>,{" "}
          <b>Normal</b>, or <b>Aggressive</b> off the tee; <b>Lag</b>,{" "}
          <b>Roll it</b>, or <b>Charge</b> on the greens; <b>Punch</b>,{" "}
          <b>Chip</b>, or <b>Flop</b> around them. Each choice genuinely shifts
          the odds:
        </p>
        <ul className="hiw-list">
          <li><b>Safe</b> finds the short grass far more often and almost never blows up — but rarely sets up a birdie.</li>
          <li><b>Aggressive</b> chases eagles and birdies, but brings real blow-up risk.</li>
          <li>You only get a handful of aggressive plays per round — <b>picking which holes to spend them on is the skill.</b></li>
        </ul>
      </section>

      <section className="hiw-block hiw-key">
        <h2 className="hiw-h">Why a safe play can still make bogey</h2>
        <p>
          This is real golf, so it runs on <b>probabilities</b> — not guarantees.
          Playing safe genuinely <b>lowers</b> your risk, but it can&apos;t remove
          it. A safe tee shot might find the fairway <b>~64%</b> of the time —
          which also means it misses sometimes. So a safe play is{" "}
          <b>&quot;bogey unlikely,&quot; never &quot;bogey impossible.&quot;</b>
        </p>
        <p>
          When you play safe and still make bogey, you didn&apos;t do anything
          wrong — you took the low-risk option and landed on the unlucky side of
          it. That&apos;s golf. <b>Good decisions win out over a full round, not
          on every single hole.</b>
        </p>
      </section>

      <section className="hiw-block">
        <h2 className="hiw-h">It&apos;s not random</h2>
        <p>
          Under the hood, better decisions really do score better over time —
          consistently smart risk management beats reckless play by a clear
          margin. A single hole can feel like a coin flip, but across 18 holes
          (and a streak of days) your choices are what separate breaking par
          from blowing up. After each hole, we now show you{" "}
          <b>the odds you actually faced</b>, so you can see your decision moved
          the numbers — the result was just one roll inside them.
        </p>
      </section>

      <section className="hiw-block">
        <h2 className="hiw-h">Fair play</h2>
        <p>
          Everyone plays the exact same course, conditions, and holes each day —
          scores are directly comparable. Outcomes are decided on the server from
          a daily seed, so results can&apos;t be tampered with or re-rolled.
          You get one attempt at the daily; that&apos;s what makes the
          leaderboard mean something.
        </p>
      </section>

      <div className="hiw-cta">
        <Link href="/" className="cta">Back to today&apos;s round</Link>
      </div>

      <div className="footnote">
        Course names are trademarks of their owners; Break Par is unaffiliated
        and layouts/yardages are stylized for play.
      </div>
    </div>
  );
}
