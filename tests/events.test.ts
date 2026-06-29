import { describe, it, expect } from "vitest";
import { rollEvent, momentumFor, applyEvent, EVENT_FIRE_RATE, EVENTS } from "@/lib/engine/events";
import type { Lie } from "@/lib/engine/shots";
import type { Outcome } from "@/lib/engine/probabilities";

describe("rollEvent", () => {
  it("is deterministic for a given seed", () => {
    const a = rollEvent("approach", 12345);
    const b = rollEvent("approach", 12345);
    expect(a?.instance.id).toBe(b?.instance.id);
  });

  it("only fires eligible events for the stage", () => {
    // PURE_GREENS / DOWNHILL_SLIDER are putt-only; GUST is tee/approach.
    for (let s = 1; s < 800; s++) {
      const ev = rollEvent("putt", s);
      if (ev) expect(["PURE_GREENS", "DOWNHILL_SLIDER"]).toContain(ev.instance.id);
    }
  });

  it("fires on roughly EVENT_FIRE_RATE of shots", () => {
    let fired = 0;
    const n = 20_000;
    for (let s = 1; s <= n; s++) if (rollEvent("approach", s * 2654435761)) fired++;
    const rate = fired / n;
    expect(rate).toBeGreaterThan(EVENT_FIRE_RATE - 0.05);
    expect(rate).toBeLessThan(EVENT_FIRE_RATE + 0.05);
  });
});

describe("momentum (deterministic, no dice)", () => {
  it("boosts after back-to-back birdies", () => {
    expect(momentumFor(["birdie", "birdie"])?.id).toBe("MOMENTUM_UP");
    expect(momentumFor(["par", "eagle", "birdie"])?.id).toBe("MOMENTUM_UP");
  });
  it("wobbles after a recent blow-up", () => {
    expect(momentumFor(["double"])?.id).toBe("MOMENTUM_DOWN");
    expect(momentumFor(["birdie", "triple"])?.id).toBe("MOMENTUM_DOWN");
  });
  it("stays quiet otherwise", () => {
    expect(momentumFor(["par", "par"])).toBeNull();
    expect(momentumFor([])).toBeNull();
  });
  it("takes precedence on the first shot of a hole", () => {
    const ev = rollEvent("tee", 1, { firstShotOfHole: true, recent: ["birdie", "birdie"] as Outcome[] });
    expect(ev?.instance.id).toBe("MOMENTUM_UP");
  });
});

describe("applyEvent", () => {
  it("a GUST shifts tee weights toward worse lies", () => {
    const gust = EVENTS.find((e) => e.id === "GUST")!;
    const w: Record<Lie, number> = { dialed: 30, fairway: 40, rough: 20, trouble: 10 };
    applyEvent(gust, "tee", w as unknown as Record<string, number>);
    expect(w.dialed).toBeLessThan(30);
    expect(w.trouble).toBeGreaterThan(10);
  });
});
