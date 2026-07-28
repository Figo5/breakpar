import { describe, expect, it } from "vitest";

import {
  CAREER_LEGACY_MILESTONES,
  CAREER_LEGACY_STARTING_TITLE,
  careerLegacyAwardCopy,
  careerLegacyTitle,
  groupCareerLegacyBySeason,
  type CareerLegacyEntry,
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

describe("Legacy season breakdown", () => {
  const entry = (
    id: string,
    seasonNumber: number,
    awardType: string,
    points: number,
    tier: "LOCAL" | "CHALLENGER" | "PRO" = "LOCAL",
  ): CareerLegacyEntry => ({
    id,
    awardType,
    ...careerLegacyAwardCopy(awardType),
    points,
    runningTotal: 0,
    sourceType: awardType.startsWith("championship") ? "championship" : "season",
    sourceId: `${seasonNumber}:${id}`,
    context: `Season ${seasonNumber}`,
    seasonNumber,
    tier,
    earnedAt: "2026-07-28T00:00:00.000Z",
  });

  it("groups every immutable row into exactly one season total", () => {
    const entries = [
      entry("a", 1, "activeSeasonCompletion", 3),
      entry("b", 1, "promotion", 20),
      entry("c", 2, "eventCompletion", 4, "CHALLENGER"),
      entry("d", 2, "eventWin", 15, "CHALLENGER"),
    ];
    const seasons = groupCareerLegacyBySeason(entries);

    expect(seasons.map((season) => ({
      season: season.seasonNumber,
      points: season.points,
      indicators: season.indicators,
    }))).toEqual([
      { season: 2, points: 19, indicators: [] },
      { season: 1, points: 23, indicators: ["promotion"] },
    ]);
    expect(seasons.reduce((sum, season) => sum + season.points, 0))
      .toBe(entries.reduce((sum, row) => sum + row.points, 0));
    expect(seasons[0].categories).toHaveLength(2);
  });

  it("shows Championship and trophy indicators without duplicating points", () => {
    const entries = [
      entry("q", 4, "championshipQualification", 35, "CHALLENGER"),
      entry("w", 4, "championshipWin", 100, "CHALLENGER"),
    ];
    const seasons = groupCareerLegacyBySeason(entries, [{
      sourceType: "championship",
      sourceId: "cycle-1",
      seasonNumber: 4,
      tier: "CHALLENGER",
    }]);
    expect(seasons).toHaveLength(1);
    expect(seasons[0].points).toBe(135);
    expect(seasons[0].indicators).toEqual(["championship", "trophy"]);
  });
});
