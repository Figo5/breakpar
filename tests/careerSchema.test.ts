import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Schema-level guards for the player-paced Career pivot (Iteration 2).
 *
 * These assert the *shape* of the generated Prisma datamodel, so the approved
 * product decisions in docs/career-player-paced-design.md §18 cannot be silently
 * reverted by a later schema edit. They touch no database.
 */
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

function fieldNames(modelName: string): string[] {
  const model = models.get(modelName);
  if (!model) throw new Error(`Model ${modelName} is missing from the datamodel`);
  return model.fields.map((field) => field.name);
}

describe("Career schema — models removed by the player-paced pivot", () => {
  it.each([
    "CareerSeason",
    "CareerEnrollment",
    "CareerQualificationContribution",
  ])("%s no longer exists", (name) => {
    expect(models.has(name)).toBe(false);
  });
});

describe("Career schema — models retained by the pivot", () => {
  it.each([
    "CareerWorld",
    "CareerProfile",
    "CareerCohort",
    "CareerCohortMember",
    "CareerCompetition",
    "CareerEventEntry",
    "CareerLockRevision",
    "CareerFieldSlot",
    "CareerResult",
    "CareerEventFinal",
    "CareerSeasonSettlement",
    "CareerSeasonHistory",
    "CareerRatingHistory",
    "CareerLegacyLedger",
    "CareerTrophy",
    "CareerChampionship",
    "CareerChampionshipSlot",
    "CareerChampionshipResult",
    "CareerSettlementAttempt",
    "CareerStagedEffect",
    "CareerCommittedEffect",
    "CareerOutbox",
  ])("%s still exists", (name) => {
    expect(models.has(name)).toBe(true);
  });
});

describe("Career schema — the Journey is personal and undated", () => {
  it("CareerWorld has no season length or calendar window", () => {
    const fields = fieldNames("CareerWorld");
    expect(fields).not.toContain("seasonLengthDays");
    expect(fields).toContain("worldKey");
  });

  it("CareerWorld no longer relates to seasons or enrollments", () => {
    const fields = fieldNames("CareerWorld");
    expect(fields).not.toContain("seasons");
    expect(fields).not.toContain("enrollments");
    expect(fields).toEqual(expect.arrayContaining(["profiles", "bots", "cohorts", "championships"]));
  });

  it("worldKey is unique, which enforces one Journey per player", () => {
    const worldKey = models.get("CareerWorld")!.fields.find((field) => field.name === "worldKey")!;
    expect(worldKey.isUnique).toBe(true);
  });
});

describe("Career schema — inactivity is gone, cycle counter added", () => {
  it("CareerProfile drops consecutiveInactiveSeasons and gains settledSeasons", () => {
    const fields = fieldNames("CareerProfile");
    expect(fields).not.toContain("consecutiveInactiveSeasons");
    expect(fields).toContain("settledSeasons");
  });

  it("CareerProfile no longer relates to enrollments", () => {
    expect(fieldNames("CareerProfile")).not.toContain("enrollments");
  });
});

describe("Career schema — the cohort IS the season", () => {
  it("CareerCohort no longer points at a dated parent season", () => {
    const fields = fieldNames("CareerCohort");
    expect(fields).not.toContain("seasonId");
    expect(fields).not.toContain("season");
    expect(fields).toEqual(expect.arrayContaining(["worldId", "seasonNumber", "tier", "state"]));
  });
});

describe("Career schema — no-shows are unreachable, so the column is gone", () => {
  it.each(["CareerResult", "CareerChampionshipResult"])("%s has no noShow column", (name) => {
    expect(fieldNames(name)).not.toContain("noShow");
  });
});
