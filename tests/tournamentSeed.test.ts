import { describe, expect, it } from "vitest";

import { courseBySlug } from "@/data/courses";
import {
  assessTournamentSeeds,
  neutralTournamentSeedKey,
  selectNeutralTournamentSeed,
  TOURNAMENT_SEED_CANDIDATES,
} from "@/lib/tournamentSeed";

const course = courseBySlug("pebble-beach")!;

describe("neutral tournament seed selection", () => {
  it("is deterministic and differs by round namespace", () => {
    const first = neutralTournamentSeedKey("tournament-a:1", course);
    expect(neutralTournamentSeedKey("tournament-a:1", course)).toBe(first);
    expect(neutralTournamentSeedKey("tournament-a:2", course)).not.toBe(first);
  });

  it("selects the median field-mean candidate instead of either extreme", () => {
    const assessed = assessTournamentSeeds("tournament-b:1", course)
      .sort((a, b) => a.fieldMean - b.fieldMean || a.seedKey.localeCompare(b.seedKey));
    const selected = selectNeutralTournamentSeed(assessed);

    expect(assessed).toHaveLength(TOURNAMENT_SEED_CANDIDATES);
    expect(selected).toBe(assessed[Math.floor(assessed.length / 2)].seedKey);
    expect(selected).not.toBe(assessed[0].seedKey);
    expect(selected).not.toBe(assessed.at(-1)!.seedKey);
  });
});
