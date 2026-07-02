import { describe, it, expect } from "vitest";
import { deriveMutuals, nonMutualFollowerIds, normalizeQuery, applyFriendPrivacy } from "@/lib/friends";

const label = (rel: number) => (rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`);

describe("deriveMutuals — a friend is a mutual follow", () => {
  it("returns only ids present in both directions", () => {
    const m = deriveMutuals(["a", "b", "c"], ["b", "c", "z"]);
    expect([...m].sort()).toEqual(["b", "c"]);
  });
  it("empty when no overlap (all one-way follows)", () => {
    expect([...deriveMutuals(["a", "b"], ["x", "y"])]).toEqual([]);
  });
  it("empty when you follow no one", () => {
    expect([...deriveMutuals([], ["a"])]).toEqual([]);
  });
});

describe("nonMutualFollowerIds — followers you don't follow back (Follow-back list)", () => {
  it("returns followers minus the people you already follow", () => {
    // you follow [a,b]; followers are [b,c,d] -> c,d follow you but you don't
    // follow back (b is mutual -> excluded, it's a friend).
    expect(nonMutualFollowerIds(["a", "b"], ["b", "c", "d"]).sort()).toEqual(["c", "d"]);
  });
  it("empty when every follower is already mutual (all in Friends)", () => {
    expect(nonMutualFollowerIds(["a", "b"], ["a", "b"])).toEqual([]);
  });
  it("empty when you have no followers", () => {
    expect(nonMutualFollowerIds(["a"], [])).toEqual([]);
  });
  it("is disjoint from mutuals (no duplication across Friends/Followers sections)", () => {
    const following = ["a", "b"];
    const followers = ["b", "c"];
    const mutual = deriveMutuals(following, followers); // {b}
    const backable = nonMutualFollowerIds(following, followers); // [c]
    expect(backable.some((id) => mutual.has(id))).toBe(false);
  });
});

describe("normalizeQuery — search input hygiene", () => {
  it("trims and strips a leading @", () => {
    expect(normalizeQuery("  @Tiger ")).toBe("Tiger");
  });
  it("returns null for empty/whitespace/non-string", () => {
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery(42)).toBeNull();
  });
  it("bounds the length to 40 chars", () => {
    expect(normalizeQuery("x".repeat(100))).toHaveLength(40);
  });
});

describe("applyFriendPrivacy — passive discovery respects the toggle", () => {
  it("withholds a private friend's score even when they played", () => {
    const r = applyFriendPrivacy(false, -3, 12, label);
    expect(r).toEqual({ score: null, played: true, private: true, puzzleNo: null });
  });
  it("private + not played still leaks nothing", () => {
    const r = applyFriendPrivacy(false, null, 12, label);
    expect(r.private).toBe(true);
    expect(r.score).toBeNull();
  });
  it("public friend who played shows their to-par score", () => {
    expect(applyFriendPrivacy(true, -2, 12, label)).toEqual({
      score: "-2", played: true, private: false, puzzleNo: 12,
    });
  });
  it("public friend who hasn't played today shows no score", () => {
    expect(applyFriendPrivacy(true, null, 12, label)).toEqual({
      score: null, played: false, private: false, puzzleNo: 12,
    });
  });
  it("labels even par as E", () => {
    expect(applyFriendPrivacy(true, 0, 5, label).score).toBe("E");
  });
});
