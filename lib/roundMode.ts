/**
 * Human-facing label for a stored Round.mode.
 *
 * Keep this explicit: falling every non-daily mode through to "Practice"
 * misattributes Career and Tournament cards in profile/history surfaces.
 */
export function roundModeLabel(mode: string, puzzleNo?: number | null): string {
  switch (mode) {
    case "daily":
      return puzzleNo ? `#${puzzleNo}` : "Daily";
    case "unlimited":
      return "Practice";
    case "challenge":
      return "Challenge";
    case "tournament":
      return "Tournament";
    case "career":
      return "Career";
    default:
      return "Round";
  }
}
