import { describe, expect, it } from "vitest";

import {
  reconcileChampionshipStandings,
  reconcileLegacyProjection,
  type ChampionshipResultView,
} from "@/lib/career/reconcile";

function result(
  slotNumber: number,
  overrides: Partial<ChampionshipResultView> = {},
): ChampionshipResultView {
  return { slotNumber, completed: true, rank: slotNumber, isWinner: slotNumber === 1, ...overrides };
}

describe("reconcileLegacyProjection", () => {
  it("passes when the projection equals the ledger sum", () => {
    expect(reconcileLegacyProjection("p1", 135, 135)).toBeNull();
  });
  it("flags a projection that drifts from the ledger sum", () => {
    const issue = reconcileLegacyProjection("p1", 100, 135);
    expect(issue).not.toBeNull();
    expect(issue!.invariant).toBe("legacy-projection-matches-ledger");
    expect(issue!.scope).toBe("profile:p1");
  });
});

describe("reconcileChampionshipStandings", () => {
  const healthy = Array.from({ length: 20 }, (_, index) =>
    result(index + 1, { isWinner: index === 0 }));

  it("ignores championships that are not settled", () => {
    expect(reconcileChampionshipStandings("c", "ACTIVE", 20, healthy)).toEqual([]);
  });

  it("passes a healthy settled 20-field with one winner", () => {
    expect(reconcileChampionshipStandings("c", "SETTLED", 20, healthy)).toEqual([]);
  });

  it("flags an incomplete field", () => {
    const issues = reconcileChampionshipStandings("c", "SETTLED", 20, healthy.slice(0, 19));
    expect(issues.some((i) => i.invariant === "championship-field-complete")).toBe(true);
  });

  it("flags zero or multiple winners", () => {
    const two = healthy.map((r, i) => ({ ...r, isWinner: i < 2 }));
    expect(reconcileChampionshipStandings("c", "SETTLED", 20, two)
      .some((i) => i.invariant === "championship-single-winner")).toBe(true);
  });

  it("flags a completed-but-unranked competitor", () => {
    const corrupt = [
      result(1, { isWinner: true }),
      result(2, { completed: true, rank: null }),
      ...Array.from({ length: 18 }, (_, index) => result(index + 3, { isWinner: false })),
    ];
    const issues = reconcileChampionshipStandings("c", "SETTLED", 20, corrupt);
    expect(issues.some((i) => i.invariant === "championship-completed-ranked")).toBe(true);
  });

  it("flags an incomplete competitor, because absence cannot settle", () => {
    // An unplayed Championship never settles, so a settled field containing an
    // incomplete competitor is corruption rather than a legitimate no-show.
    const corrupt = [
      result(1, { isWinner: true }),
      result(2, { completed: false, rank: null }),
      ...Array.from({ length: 18 }, (_, index) => result(index + 3, { isWinner: false })),
    ];
    const issues = reconcileChampionshipStandings("c", "SETTLED", 20, corrupt);
    expect(issues.some((i) => i.invariant === "championship-all-completed")).toBe(true);
  });
});
