import { describe, it, expect } from "vitest";
import { BOTS, botByUsername, isBotUsername, simulateBotRound, revealBotHoles } from "@/lib/botPlayer";
import { COURSES } from "@/data/courses";
import { holeShotSeed } from "@/lib/engine/rng";

const SLUG = COURSES[0].slug;

describe("BOTS registry", () => {
  it("has three bots with distinct reserved usernames", () => {
    const names = Object.values(BOTS).map((b) => b.username);
    expect(names.length).toBe(3);
    expect(new Set(names).size).toBe(3);
  });

  it("botByUsername round-trips and rejects strangers", () => {
    for (const [key, b] of Object.entries(BOTS)) {
      expect(botByUsername(b.username)?.key).toBe(key);
    }
    expect(botByUsername("gio")).toBeNull();
    expect(isBotUsername("scratch-the-bot")).toBe(true);
    expect(isBotUsername("scratch")).toBe(false);
  });
});

describe("simulateBotRound", () => {
  it("returns null for unknown bot or course", () => {
    expect(simulateBotRound("seed", SLUG, "nope")).toBeNull();
    expect(simulateBotRound("seed", "not-a-course", "scratch")).toBeNull();
  });

  it("plays a full 18 with a plausible total", () => {
    const r = simulateBotRound("challenge-abc", SLUG, "scratch")!;
    expect(r.holes).toHaveLength(18);
    // Sanity band: nobody shoots 40 or 140 in this engine.
    expect(r.score).toBeGreaterThan(54);
    expect(r.score).toBeLessThan(120);
    expect(r.relativeToPar).toBe(r.score - COURSES[0].holes.reduce((s, h) => s + h.par, 0));
  });

  it("is DETERMINISTIC: same seedKey + bot => identical round every time", () => {
    const a = simulateBotRound("challenge-abc", SLUG, "ace")!;
    const b = simulateBotRound("challenge-abc", SLUG, "ace")!;
    expect(a).toEqual(b);
  });

  it("different seedKeys produce different rounds", () => {
    const a = simulateBotRound("challenge-abc", SLUG, "ace")!;
    const b = simulateBotRound("challenge-xyz", SLUG, "ace")!;
    expect(a.holes.map((h) => h.scoreChange)).not.toEqual(b.holes.map((h) => h.scoreChange));
  });

  it("different bots on the SAME seed produce different rounds (policies differ)", () => {
    const a = simulateBotRound("challenge-abc", SLUG, "rusty")!;
    const b = simulateBotRound("challenge-abc", SLUG, "ace")!;
    expect(a.holes.map((h) => h.scoreChange)).not.toEqual(b.holes.map((h) => h.scoreChange));
  });

  it("the bot's dice are NOT the human's dice (salted namespace)", () => {
    // If the bot consumed the raw seedKey stream, a player could watch the bot
    // to learn their own upcoming rolls. The bot's seed for hole 1 shot 0 must
    // differ from the human's for the same challenge.
    const human = holeShotSeed("challenge-abc", 1, 0);
    const bot = holeShotSeed("challenge-abc:bot:ace", 1, 0);
    expect(bot).not.toBe(human);
  });

  it("per-hole scoreChanges are internally consistent with the totals", () => {
    const r = simulateBotRound("challenge-abc", SLUG, "scratch")!;
    const sumChanges = r.holes.reduce((s, h) => s + h.scoreChange, 0);
    expect(r.relativeToPar).toBe(sumChanges);
  });

  it("every hole records a real outcome string", () => {
    const r = simulateBotRound("challenge-abc", SLUG, "rusty")!;
    for (const h of r.holes) {
      expect(h.outcome.length).toBeGreaterThan(0);
      expect(Number.isFinite(h.scoreChange)).toBe(true);
    }
  });

  it("works across the whole roster (no course crashes the loop)", () => {
    for (const c of COURSES) {
      const r = simulateBotRound("seed-roster", c.slug, "scratch");
      expect(r, c.slug).not.toBeNull();
      expect(r!.holes, c.slug).toHaveLength(18);
    }
  });
});

describe("revealBotHoles (pacing)", () => {
  const round = simulateBotRound("challenge-abc", SLUG, "scratch")!;

  it("shows nothing before the human tees off", () => {
    expect(revealBotHoles(round, 0)).toHaveLength(0);
  });

  it("shows exactly as many holes as the human has completed", () => {
    expect(revealBotHoles(round, 7)).toHaveLength(7);
    expect(revealBotHoles(round, 7).map((h) => h.holeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("caps at 18 and floors at 0", () => {
    expect(revealBotHoles(round, 99)).toHaveLength(18);
    expect(revealBotHoles(round, -3)).toHaveLength(0);
  });
});
