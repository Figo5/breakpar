export type BallDisplayState = "line" | "rough" | "trouble" | "short" | "water";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Keep HoleMap's existing numeric seam while carrying the lie needed by the
 * illustration. Values in [0, 1] remain ordinary centre-line progress.
 */
export function encodeBallDisplay(
  progress: number,
  lie: string | null,
  nextStage: string,
  penalty = false,
): number {
  const p = clamp(progress);
  if (penalty) return 3 + p;
  if (nextStage === "scramble") return 2 + p;
  if (lie === "trouble") return -2 - p;
  if (lie === "rough") return -1 - p;
  return p;
}

export function decodeBallDisplay(value: number): { progress: number; state: BallDisplayState } {
  if (value >= 3) return { progress: clamp(value - 3), state: "water" };
  if (value >= 2) return { progress: clamp(value - 2), state: "short" };
  if (value <= -2) return { progress: clamp(-value - 2), state: "trouble" };
  if (value <= -1) return { progress: clamp(-value - 1), state: "rough" };
  return { progress: clamp(value), state: "line" };
}

/** Minimal server-step shape needed to choose the marker treatment. Keeping
 * this adapter pure gives the play screen and regression tests one shared
 * contract: a scored hazard must render in water, a missed green short of the
 * target, and an ordinary lie on/off the fairway as resolved by the engine. */
export interface BallDisplayStep {
  progress: number | null | undefined;
  lie: string | null | undefined;
  nextStage: string;
  shots: Array<{ penalty?: unknown }> | null | undefined;
}

export function encodeStepBallDisplay(step: BallDisplayStep): number {
  const latest = step.shots?.[step.shots.length - 1];
  return encodeBallDisplay(
    typeof step.progress === "number" ? step.progress : 0.05,
    step.lie ?? null,
    step.nextStage,
    !!latest?.penalty,
  );
}
