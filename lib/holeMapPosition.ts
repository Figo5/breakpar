export type MapPoint = { x: number; y: number };
export type EllipseHazard = MapPoint & { rx: number; ry: number };

export function pointClearsEllipse(point: MapPoint, hazard: EllipseHazard, padding = 10): boolean {
  const dx = (point.x - hazard.x) / (hazard.rx + padding);
  const dy = (point.y - hazard.y) / (hazard.ry + padding);
  return dx * dx + dy * dy > 1;
}

/** Pick the first preferred display position that does not overlap water. */
export function pickDryBallPosition(
  candidates: MapPoint[],
  water: EllipseHazard | null,
): MapPoint {
  if (!candidates.length) throw new Error("At least one ball position is required");
  if (!water) return candidates[0];
  return candidates.find((point) => pointClearsEllipse(point, water)) ?? candidates[candidates.length - 1];
}
