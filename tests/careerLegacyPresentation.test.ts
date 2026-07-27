import { describe, expect, it } from "vitest";

import {
  CAREER_LEGACY_MILESTONES,
  CAREER_LEGACY_STARTING_TITLE,
  careerLegacyAwardCopy,
  careerLegacyTitle,
} from "@/lib/career/legacy";

describe("Legacy titles", () => {
  it("starts unranked and climbs the frozen ladder", () => {
    expect(careerLegacyTitle(0)).toMatchObject({
      title: CAREER_LEGACY_STARTING_TITLE,
      nextTitle: "Club Regular",
      nextThreshold: 250,
      pointsToNext: 250,
      progress: 0,
    });
    expect(careerLegacyTitle(125).progress).toBeCloseTo(0.5);
    expect(careerLegacyTitle(250)).toMatchObject({
      title: "Club Regular",
      earnedAt: 250,
      nextTitle: "Tour Veteran",
      nextThreshold: 1_000,
      pointsToNext: 750,
    });
    expect(careerLegacyTitle(9_999).title).toBe("Tour Legend");
    expect(careerLegacyTitle(10_000).title).toBe("Hall of Fame");
  });

  it("tops out without inventing a rung above the ladder", () => {
    const top = CAREER_LEGACY_MILESTONES.at(-1)!;
    expect(careerLegacyTitle(top.threshold)).toMatchObject({
      title: top.title,
      nextTitle: null,
      nextThreshold: null,
      pointsToNext: null,
      progress: 1,
    });
    expect(careerLegacyTitle(top.threshold * 4).title).toBe(top.title);
  });

  it("is monotonic — more Legacy never means a lower title", () => {
    let previous = -1;
    for (const points of [0, 249, 250, 999, 1_000, 2_499, 2_500, 5_000, 10_000, 25_000]) {
      const earned = careerLegacyTitle(points).earnedAt;
      expect(earned).toBeGreaterThanOrEqual(previous);
      previous = earned;
    }
  });
});

describe("Legacy award copy", () => {
  it("explains every award type the settlement engine publishes", () => {
    const published = [
      "eventCompletion",
      "eventTopFive",
      "eventWin",
      "activeSeasonCompletion",
      "promotion",
      "proSurvival",
      "seasonChampionship",
      "championshipQualification",
      "championshipWin",
    ];
    for (const awardType of published) {
      const copy = careerLegacyAwardCopy(awardType);
      expect(copy.label.length).toBeGreaterThan(0);
      // A raw storage key must never reach the player.
      expect(copy.label).not.toBe(awardType);
      expect(copy.reason.endsWith(".")).toBe(true);
    }
    expect(careerLegacyAwardCopy("eventWin").label).toBe("Event win");
  });

  it("degrades an unknown future award type to something readable", () => {
    expect(careerLegacyAwardCopy("someFutureAward").label).toBe("Some future award");
    expect(careerLegacyAwardCopy("major_win").label).toBe("Major win");
    expect(careerLegacyAwardCopy("").label).toBe("Legacy award");
    expect(careerLegacyAwardCopy("someFutureAward").reason.length).toBeGreaterThan(0);
  });
});
