import { describe, expect, it } from "vitest";

import {
  deriveChampionshipLegacy,
  rankChampionshipField,
  type ChampionshipSettlementCompetitor,
  type ChampionshipStanding,
} from "@/lib/career/championshipSettlement";
import { CAREER_V1_FORMULA_BUNDLE } from "@/lib/career/formulaBundle";

function competitor(
  slotNumber: number,
  relativeToPar: number | null,
  overrides: Partial<ChampionshipSettlementCompetitor> = {},
): ChampionshipSettlementCompetitor {
  const type = overrides.competitorType ?? (slotNumber <= 12 ? "HUMAN" : "BOT");
  return {
    competitorId: overrides.competitorId ?? `${type === "HUMAN" ? "human" : "bot"}:s${slotNumber}`,
    slotNumber,
    competitorType: type,
    profileId: type === "HUMAN" ? `p${slotNumber}` : null,
    botIdentityId: type === "BOT" ? `b${slotNumber}` : null,
    relativeToPar,
    fallbackDraw: overrides.fallbackDraw ?? slotNumber / 1000,
    ...overrides,
  };
}

describe("Championship final ranking", () => {
  it("ranks by relative-to-par and crowns exactly one winner", () => {
    const field = Array.from({ length: 20 }, (_, index) =>
      competitor(index + 1, index - 5)); // −5..+14, all distinct
    const output = rankChampionshipField("champ", field);
    expect(output.fieldSize).toBe(20);
    const winner = output.standings.filter((standing) => standing.isWinner);
    expect(winner).toHaveLength(1);
    expect(winner[0].slotNumber).toBe(1); // relativeToPar −5 is best
    expect(winner[0].rank).toBe(1);
    expect(output.winnerCompetitorId).toBe(winner[0].competitorId);
    expect(output.standings.every((standing) => standing.completed && !standing.noShow)).toBe(true);
    expect(output.standings.map((standing) => standing.rank)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("breaks a tie for first with the deterministic playoff draw", () => {
    const field = [
      competitor(1, -4, { competitorId: "human:a", fallbackDraw: 0.9 }),
      competitor(2, -4, { competitorId: "bot:b", fallbackDraw: 0.1 }),
      ...Array.from({ length: 18 }, (_, index) => competitor(index + 3, index + 1)),
    ];
    const output = rankChampionshipField("champ", field);
    const winners = output.standings.filter((standing) => standing.isWinner);
    expect(winners).toHaveLength(1);
    expect(winners[0].competitorId).toBe("bot:b"); // lower fallbackDraw wins the playoff
    // Both tied leaders still share rank 1 in the frozen standings.
    expect(output.standings.filter((standing) => standing.rank === 1)).toHaveLength(2);
  });

  it("treats null scores as no-shows with rank null and no points", () => {
    const field = [
      competitor(1, -3),
      competitor(2, null),
      ...Array.from({ length: 18 }, (_, index) => competitor(index + 3, index + 1)),
    ];
    const output = rankChampionshipField("champ", field);
    const noShow = output.standings.find((standing) => standing.slotNumber === 2)!;
    expect(noShow.noShow).toBe(true);
    expect(noShow.completed).toBe(false);
    expect(noShow.rank).toBeNull();
    expect(noShow.points).toBe(0);
    expect(output.standings.filter((standing) => standing.isWinner)).toHaveLength(1);
  });

  it("rejects duplicate slots or competitors", () => {
    expect(() => rankChampionshipField("champ", [competitor(1, 0), competitor(1, 1)])).toThrow();
    expect(() => rankChampionshipField("champ", [
      competitor(1, 0, { competitorId: "dup" }),
      competitor(2, 1, { competitorId: "dup" }),
    ])).toThrow();
  });
});

function standing(
  slotNumber: number,
  type: "HUMAN" | "BOT",
  overrides: Partial<ChampionshipStanding> = {},
): ChampionshipStanding {
  return {
    slotNumber,
    competitorId: `${type === "HUMAN" ? "human" : "bot"}:s${slotNumber}`,
    competitorType: type,
    profileId: type === "HUMAN" ? `p${slotNumber}` : null,
    botIdentityId: type === "BOT" ? `b${slotNumber}` : null,
    completed: true,
    noShow: false,
    relativeToPar: 0,
    rank: slotNumber,
    points: 0,
    isWinner: false,
    ...overrides,
  };
}

const SCHEDULE = CAREER_V1_FORMULA_BUNDLE.legacyPoints;

describe("Championship Legacy award derivation", () => {
  it("awards only 100 + a trophy to a human winner because qualification pays at unlock", () => {
    const standings = [
      standing(1, "HUMAN", { rank: 1, isWinner: true, relativeToPar: -6 }),
      standing(2, "HUMAN", { rank: 2 }),
      standing(3, "HUMAN", { noShow: true, completed: false, rank: null }),
      standing(4, "BOT", { rank: 3 }),
      standing(5, "BOT", { rank: 4 }),
    ];
    const { awards, trophyProfileId } = deriveChampionshipLegacy(standings, SCHEDULE);
    expect(awards).toEqual([{ profileId: "p1", awardType: "championshipWin", points: 100 }]);
    expect(trophyProfileId).toBe("p1");
    // Bots accrue no human Legacy.
    expect(awards.some((a) => a.profileId === null)).toBe(false);
  });

  it("gives no win award or trophy when a bot wins", () => {
    const standings = [
      standing(1, "BOT", { rank: 1, isWinner: true, relativeToPar: -8 }),
      standing(2, "HUMAN", { rank: 2 }),
      standing(3, "HUMAN", { rank: 3 }),
    ];
    const { awards, trophyProfileId } = deriveChampionshipLegacy(standings, SCHEDULE);
    expect(trophyProfileId).toBeNull();
    expect(awards).toEqual([]);
  });
});
