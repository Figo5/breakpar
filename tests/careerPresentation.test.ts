import { describe, expect, it } from "vitest";

import {
  availabilityLabel,
  canContestChampionship,
  eventAvailability,
  lifecycleLabel,
  movementLabel,
  pointsLabel,
  scoreLabel,
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
});
