import { HoleArt } from "@/components/HoleArt";
import type { CourseHole } from "@/data/courses";

/**
 * HoleMap — the swappable map surface (the "seam").
 *
 * Today it renders HoleArt (the current procedural illustration). When the OSM
 * hole-geometry pipeline is ready, the OSM renderer drops in HERE — behind this
 * one component — and the play screen never changes. The play screen's header,
 * to-par pill, condition chips, scrims, and shot-line all live OUTSIDE this
 * component (in page.tsx), so they survive the swap untouched.
 *
 * Keep this prop signature stable: it's the contract the play screen depends on.
 * An OSM implementation should accept the same props and fall back to HoleArt
 * for any hole it can't draw (e.g. missing/failed geometry), so a partial OSM
 * rollout never leaves a hole blank.
 */
export function HoleMap({
  hole,
  wind,
  windDir,
  greens,
  ballT = 0.05,
}: {
  hole: CourseHole;
  wind: number;
  windDir: number;
  greens: string;
  ballT?: number;
}) {
  // v1: procedural illustration. (OSM geometry will branch in here later.)
  return <HoleArt hole={hole} wind={wind} windDir={windDir} greens={greens} ballT={ballT} />;
}
