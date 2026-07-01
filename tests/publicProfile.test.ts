import { describe, it, expect } from "vitest";
import { pickFeatured } from "@/lib/publicProfile";
import type { TrophyState, TrophyTier } from "@/lib/trophies";

const earnedTrophy = (id: string, tier: TrophyTier, unlockedAt: string | null = null): TrophyState => ({
  id, label: id, category: "scoring", tier, criteria: "", comingSoon: false,
  earned: true, current: 1, target: 1, progressPct: 100, unlockedAt,
});

describe("publicProfile — pickFeatured", () => {
  const earned = [
    earnedTrophy("a", "common", "2026-06-01T00:00:00.000Z"),
    earnedTrophy("b", "legendary", "2026-06-02T00:00:00.000Z"),
    earnedTrophy("c", "rare", "2026-06-03T00:00:00.000Z"),
    earnedTrophy("d", "elite", null),
  ];

  it("uses the owner's picks in their chosen order", () => {
    expect(pickFeatured(["c", "a"], earned).map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("drops picks that aren't earned (defensive)", () => {
    expect(pickFeatured(["c", "ghost", "a"], earned).map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("caps at 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => earnedTrophy(`t${i}`, "common"));
    expect(pickFeatured(many.map((t) => t.id), many)).toHaveLength(5);
  });

  it("falls back to rarity desc, then most-recent unlock, when no picks", () => {
    // legendary(b) > elite(d) > rare(c) > common(a); d has null date (sorts after dated within tier, but tier wins)
    expect(pickFeatured([], earned).map((t) => t.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("empty when nothing earned and no picks", () => {
    expect(pickFeatured([], [])).toEqual([]);
  });
});
