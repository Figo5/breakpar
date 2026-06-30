import { describe, it, expect } from "vitest";
import { puttNote } from "@/lib/engine/notes";

describe("puttNote — conservative three-putt reads as bad luck", () => {
  const at0 = () => 0; // deterministic: always picks index 0 of the pool

  it("a Lag (safe) three-putt emits a bad-luck note distinct from a charged one", () => {
    const safe = puttNote("threeputt", "long", 20, at0, "safe");
    const charged = puttNote("threeputt", "long", 20, at0, "aggressive");
    expect(safe).not.toBe(charged); // the special-case pool fired
    expect(safe).toMatch(/safe|wicked|tough|right/i); // reads as variance, not a yip
    expect(safe).toContain("20"); // footage woven in
  });

  it("a lag-position (long) Roll three-putt also reads as bad luck (framed as a two-putt)", () => {
    const normalLong = puttNote("threeputt", "long", 20, at0, "normal");
    const safeLong = puttNote("threeputt", "long", 20, at0, "safe");
    expect(normalLong).toBe(safeLong); // the conservative-framing pool fired for Roll too
  });

  it("Charge (aggressive) three-putts stay on you (standard note)", () => {
    const aggressive = puttNote("threeputt", "long", 20, at0, "aggressive");
    const safe = puttNote("threeputt", "long", 20, at0, "safe");
    expect(aggressive).not.toBe(safe); // charging's three-jack is not excused
  });

  it("a SHORT Roll three-putt is a yip, not bad luck (no two-putt framing there)", () => {
    const normalShort = puttNote("threeputt", "short", 8, at0, "normal");
    const safeShort = puttNote("threeputt", "short", 8, at0, "safe");
    expect(normalShort).not.toBe(safeShort); // only safe is excused at short range
  });

  it("only three-putts trigger it — a safe two-putt is unaffected", () => {
    const safeTwo = puttNote("twoputt", "long", 20, at0, "safe");
    const normalTwo = puttNote("twoputt", "long", 20, at0, "normal");
    expect(safeTwo).toBe(normalTwo);
  });
});
