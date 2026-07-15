import type { ShotRecord } from "@/lib/engine/shots";
import type { Outcome } from "@/lib/engine/probabilities";

const SCORE_LABEL: Record<Outcome, string> = {
  eagle: "eagle",
  birdie: "birdie",
  par: "par",
  bogey: "bogey",
  double: "double bogey",
  triple: "triple bogey",
};

/** Makes the final stroke count explicit when the headline score alone is
 * ambiguous—for example, a par after reaching a par 5 in two is a three-putt. */
export function finishSummary(shots: ShotRecord[], outcome: Outcome): string | null {
  const finish = shots[shots.length - 1];
  if (!finish?.puttResult) return null;

  const putts = finish.puttResult === "oneputt" ? "One-putt" : finish.puttResult === "twoputt" ? "Two-putt" : "Three-putt";
  return `${putts} ${SCORE_LABEL[outcome]}`;
}
