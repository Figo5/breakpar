import { SCORE_DELTA, type Outcome } from "@/lib/engine/probabilities";
import type { CourseHole } from "@/data/courses";

/** A compact, traditional golf card for the active nine. Rows mirror a real
 * yardage book: hole, yards, par, stroke index, then the player's score. */
export function Scorecard({ holes, outcomes, currentHole }: {
  holes: CourseHole[]; outcomes: (Outcome | null)[]; currentHole: number;
}) {
  const nineStart = currentHole < 9 ? 0 : 9;
  const nine = holes.slice(nineStart, nineStart + 9);
  const holesLeft = Math.max(0, holes.length - currentHole - 1);
  const played = outcomes.filter(Boolean).length;

  const score = (absoluteIndex: number) => {
    const outcome = outcomes[absoluteIndex];
    return outcome ? holes[absoluteIndex].par + SCORE_DELTA[outcome] : "–";
  };

  const row = (label: string, values: (number | string)[], scoreRow = false) => (
    <div className={`sc-line${scoreRow ? " sc-scores" : ""}`}>
      <span className="sc-label">{label}</span>
      {values.map((value, i) => {
        const absoluteIndex = nineStart + i;
        const current = absoluteIndex === currentHole;
        const playedHole = !!outcomes[absoluteIndex];
        return (
          <span
            key={`${label}-${absoluteIndex}`}
            className={`${current ? " current" : ""}${scoreRow && playedHole ? " played" : ""}`}
          >
            {value}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="scorecard" aria-label={`Golf scorecard, ${holesLeft} holes left`}>
      <div className="sc-head">
        <span>Round card · {nineStart === 0 ? "Front nine" : "Back nine"}</span>
        <b>{holesLeft === 0 ? "Round complete" : `${holesLeft} hole${holesLeft === 1 ? "" : "s"} left`}</b>
      </div>
      <div className="sc-grid">
        {row("Hole", nine.map((h) => h.number))}
        {row("Yds", nine.map((h) => h.yardage))}
        {row("Par", nine.map((h) => h.par))}
        {row("SI", nine.map((h) => h.strokeIndex))}
        {row("Score", nine.map((_, i) => score(nineStart + i)), true)}
      </div>
      <div className="sc-meta">
        <span>{played} played</span>
        <span>{holes.reduce((sum, h) => sum + h.yardage, 0).toLocaleString()} total yards</span>
      </div>
    </div>
  );
}
