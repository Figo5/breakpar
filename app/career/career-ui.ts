import type { CareerScheduleEntry } from "@/lib/career/read";

/**
 * Presentation helpers for player-paced Career.
 *
 * Nothing here reads a clock. Every event in a locked season is playable the
 * moment the season exists, nothing expires, and a season ends only when the
 * player has finished all four events — so availability is a pure function of
 * state, never of dates.
 */
export type CareerEventAvailability =
  | "complete"
  | "resume"
  | "playable"
  | "preparing"
  | "scoring"
  | "final";

export function tierLabel(tier: string): string {
  if (tier === "LOCAL") return "Local Tour";
  if (tier === "CHALLENGER") return "Challenger Tour";
  if (tier === "PRO") return "Pro Tour";
  return tier.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function lifecycleLabel(state: string): string {
  const labels: Record<string, string> = {
    // FORMING/LOCKING are momentary now — the field locks as the season is created.
    FORMING: "Preparing",
    LOCKING: "Preparing",
    LOCKED: "Ready",
    ACTIVE: "Open",
    ENDED: "Scoring",
    SETTLED: "Final",
    MANUAL_REVIEW: "Under review",
    VOID: "Cancelled",
  };
  return labels[state] ?? state.replaceAll("_", " ").toLowerCase();
}

export function eventAvailability(
  event: Pick<CareerScheduleEntry, "completed" | "state" | "roundId">,
): CareerEventAvailability {
  if (event.completed) return "complete";
  if (event.state === "SETTLED") return "final";
  if (["ENDED", "MANUAL_REVIEW", "VOID"].includes(event.state)) return "scoring";
  if (event.state === "ACTIVE") return event.roundId ? "resume" : "playable";
  return "preparing";
}

export function availabilityLabel(availability: CareerEventAvailability): string {
  const labels: Record<CareerEventAvailability, string> = {
    complete: "Card posted",
    resume: "Resume your round",
    playable: "Ready to play",
    preparing: "Preparing field",
    scoring: "Scoring",
    final: "Final",
  };
  return labels[availability];
}

export function scoreLabel(relativeToPar: number | null): string {
  if (relativeToPar == null) return "—";
  if (relativeToPar === 0) return "E";
  return relativeToPar > 0 ? `+${relativeToPar}` : `${relativeToPar}`;
}

export function pointsLabel(points: number | null): string {
  return points == null ? "—" : points.toFixed(points % 1 === 0 ? 0 : 1);
}

/** Championship field sources. Qualification is a personal four-season cycle. */
export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    "elite-bot": "Elite rival",
  };
  return labels[source] ?? "Cycle qualifier";
}

export function movementLabel(movement: string, tier: string, nextTier: string): string {
  if (movement === "PROMOTE") return `Promoted to ${tierLabel(nextTier)}`;
  if (movement === "RELEGATE") return `Moved to ${tierLabel(nextTier)}`;
  if (tier === "PRO") return "Pro Tour retained";
  return "Tour status retained";
}

/** Seasons still to complete before the next Championship cycle checkpoint. */
export function seasonsUntilChampionship(settledSeasons: number, perCycle = 4): number {
  const remainder = settledSeasons % perCycle;
  return remainder === 0 ? perCycle : perCycle - remainder;
}

/** Tiers that may contest a Championship. Mirrors the server-side gate. */
export function canContestChampionship(tier: string): boolean {
  return tier === "CHALLENGER" || tier === "PRO";
}
