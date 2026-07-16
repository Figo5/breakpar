import type { ShotRecord } from "@/lib/engine/shots";
import type { Outcome } from "@/lib/engine/probabilities";

const SCORE_LABEL: Record<Outcome, string> = {
  albatross: "albatross",
  eagle: "eagle",
  birdie: "birdie",
  par: "par",
  bogey: "bogey",
  double: "double bogey",
  triple: "triple bogey",
};

/** Makes the final stroke count explicit when the headline score alone is
 * ambiguous—for example, a par after reaching a par 5 in two is a three-putt. */
export function finishSummary(shots: ShotRecord[], outcome: Outcome, par?: number): string | null {
  const finish = shots[shots.length - 1];
  const penaltyStrokes = shots.reduce((sum, shot) => sum + (shot.penalty?.strokes ?? 0), 0);
  const penalty = penaltyStrokes > 0
    ? `${penaltyStrokes} penalty ${penaltyStrokes === 1 ? "stroke" : "strokes"}`
    : null;
  if (finish?.scoringEvent)
    return `${finish.scoringEvent.label}${penalty ? ` · ${penalty}` : ""}`;
  if (!finish?.puttResult) return penalty;

  const putts = finish.puttResult === "oneputt" ? "One-putt" : finish.puttResult === "twoputt" ? "Two-putt" : "Three-putt";
  // A par-5 normal/safe second shot is a layup followed by an automatic wedge.
  // State that hidden third explicitly so two clicks can never read as "on in 2."
  const baseGreenIn = par === 5 ? (shots.some((shot) => shot.stage === "layup") ? 3 : 2) : null;
  const greenIn = baseGreenIn === null ? null : baseGreenIn + penaltyStrokes;
  const arrival = greenIn === null ? "" : `On in ${greenIn} · `;
  return `${arrival}${putts} ${SCORE_LABEL[outcome]}${penalty ? ` · ${penalty}` : ""}`;
}
