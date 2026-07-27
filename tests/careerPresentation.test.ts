import { describe, expect, it } from "vitest";

import {
  availabilityLabel,
  canContestChampionship,
  cumulativeLabel,
  eventAvailability,
  lifecycleLabel,
  movementLabel,
  pointsLabel,
  revealLabel,
  roundProgressLabel,
  scoreLabel,
  seasonRevealLabel,
  seasonsUntilChampionship,
  sourceLabel,
  tierLabel,
} from "@/app/career/career-ui";

const base = { state: "ACTIVE", completed: false, roundId: null as string | null };

describe("Career UI presentation", () => {
  it("derives availability from state alone — no clock, nothing expires", () => {
    expect(eventAvailability(base)).toBe("playable");
    expect(eventAvailability({ ...base, roundId: "round-1" })).toBe("resume");
    expect(eventAvailability({ ...base, completed: true })).toBe("complete");
    // A completed card stays "complete" even once the event is settled.
    expect(eventAvailability({ ...base, state: "SETTLED", completed: true })).toBe("complete");
    expect(eventAvailability({ ...base, state: "SETTLED" })).toBe("final");
    expect(eventAvailability({ ...base, state: "ENDED" })).toBe("scoring");
    // FORMING/LOCKING are momentary: the field locks as the season is created.
    expect(eventAvailability({ ...base, state: "FORMING" })).toBe("preparing");
    expect(eventAvailability({ ...base, state: "LOCKING" })).toBe("preparing");
  });

  it("never labels an event as waiting on a date", () => {
    const labels = (["complete", "resume", "playable", "preparing", "scoring", "final"] as const)
      .map((availability) => availabilityLabel(availability));
    for (const label of labels) {
      expect(label).not.toMatch(/open|close|deadline|day|week|date/i);
    }
    expect(availabilityLabel("playable")).toBe("Ready to play");
    expect(availabilityLabel("resume")).toBe("Resume your round");
  });

  it("formats tour, score, points, source, and movement labels", () => {
    expect(tierLabel("CHALLENGER")).toBe("Challenger Tour");
    expect(lifecycleLabel("MANUAL_REVIEW")).toBe("Under review");
    expect(lifecycleLabel("ACTIVE")).toBe("Open");
    expect(scoreLabel(-3)).toBe("-3");
    expect(scoreLabel(0)).toBe("E");
    expect(scoreLabel(2)).toBe("+2");
    expect(pointsLabel(86.25)).toBe("86.3");
    expect(sourceLabel("elite-bot")).toBe("Elite rival");
    expect(movementLabel("PROMOTE", "LOCAL", "CHALLENGER"))
      .toBe("Promoted to Challenger Tour");
    expect(movementLabel("HOLD", "PRO", "PRO")).toBe("Pro Tour retained");
  });

  it("counts down to the next Championship cycle and gates it on tier", () => {
    // A freshly settled cycle boundary means a full four seasons to the next one.
    expect(seasonsUntilChampionship(0)).toBe(4);
    expect(seasonsUntilChampionship(4)).toBe(4);
    expect(seasonsUntilChampionship(1)).toBe(3);
    expect(seasonsUntilChampionship(3)).toBe(1);

    expect(canContestChampionship("LOCAL")).toBe(false);
    expect(canContestChampionship("CHALLENGER")).toBe(true);
    expect(canContestChampionship("PRO")).toBe(true);
  });

  it("labels the round the player is on without ever running past the last one", () => {
    expect(roundProgressLabel(0, 4)).toBe("Round 1 of 4");
    expect(roundProgressLabel(2, 4)).toBe("Round 3 of 4");
    // A finished event points at its last round, not an imaginary fifth.
    expect(roundProgressLabel(4, 4)).toBe("Round 4 of 4");
    expect(roundProgressLabel(1, 1)).toBe("Round 1 of 1");
  });

  it("states how much of an event leaderboard is on show", () => {
    expect(revealLabel(0, 4)).toBe("Scores hidden until you play");
    expect(revealLabel(1, 4)).toBe("Through round 1 of 4");
    expect(revealLabel(3, 4)).toBe("Through round 3 of 4");
    expect(revealLabel(4, 4)).toBe("All 4 rounds");
    // A partial reveal must never read as complete.
    for (const revealed of [1, 2, 3]) {
      expect(revealLabel(revealed, 4)).not.toMatch(/final|all/i);
    }
  });

  it("states how much of a season table is on show", () => {
    expect(seasonRevealLabel(0, 4)).toBe("No results yet");
    expect(seasonRevealLabel(1, 4)).toBe("Provisional · 1 of 4 events");
    expect(seasonRevealLabel(3, 4)).toBe("Provisional · 3 of 4 events");
    expect(seasonRevealLabel(4, 4)).toBe("Final · all four events");
    for (const revealed of [1, 2, 3]) {
      expect(seasonRevealLabel(revealed, 4)).toMatch(/provisional/i);
    }
  });

  it("renders a missing cumulative score as a dash, never as level par", () => {
    expect(cumulativeLabel(null)).toBe("—");
    expect(cumulativeLabel(0)).toBe("E");
    expect(cumulativeLabel(-6)).toBe("-6");
    expect(cumulativeLabel(11)).toBe("+11");
  });
});
