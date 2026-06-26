import { OUTCOME_META, SCORE_DELTA, type Outcome } from "@/lib/engine/probabilities";
import type { CourseHole } from "@/data/courses";

export function Scorecard({ holes, outcomes, currentHole }: {
  holes: CourseHole[]; outcomes: (Outcome | null)[]; currentHole: number;
}) {
  const cell = (i: number) => {
    const o = outcomes[i];
    const par = holes[i].par;
    const cur = i === currentHole && !o;
    let cls = "cell";
    let val: number | string = holes[i].number;
    if (cur) cls += " cur";
    if (o) {
      val = par + SCORE_DELTA[o];
      cls += " played";
      const tone = OUTCOME_META[o].tone;
      if (tone === "good") cls += SCORE_DELTA[o] <= -2 ? " eagle under" : " under";
      if (tone === "bad") cls += SCORE_DELTA[o] >= 2 ? " dbl over" : " over";
    }
    return <div key={i} className={cls}>{val}</div>;
  };
  const nine = (a: number, b: number) =>
    outcomes.slice(a, b).reduce((s, o, j) => o ? s + holes[a + j].par + SCORE_DELTA[o] : s, 0) || "–";

  return (
    <div className="scorecard">
      <div className="sc-row">{holes.slice(0, 9).map((_, i) => cell(i))}</div>
      <div className="sc-row">{holes.slice(9, 18).map((_, i) => cell(i + 9))}</div>
      <div className="sc-meta">
        <span>Front {nine(0, 9)}</span><span>○ under · □ over</span><span>Back {nine(9, 18)}</span>
      </div>
    </div>
  );
}
