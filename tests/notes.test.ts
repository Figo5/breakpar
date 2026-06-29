import { describe, it, expect } from "vitest";
import { puttNote } from "@/lib/engine/notes";

describe("puttNote — conservative three-putt reads as bad luck", () => {
  const at0 = () => 0; // deterministic: always picks index 0 of the pool

  it("a Lag (safe) three-putt emits a bad-luck note distinct from the standard one", () => {
    const safe = puttNote("threeputt", "long", 20, at0, "safe");
    const standard = puttNote("threeputt", "long", 20, at0, "normal");
    expect(safe).not.toBe(standard); // the special-case pool fired
    expect(safe).toMatch(/safe|wicked|tough|right/i); // reads as variance, not a yip
    expect(safe).toContain("20"); // footage woven in
  });

  it("Roll (normal) and Charge (aggressive) three-putts use the standard note", () => {
    const normal = puttNote("threeputt", "long", 20, at0, "normal");
    const aggressive = puttNote("threeputt", "long", 20, at0, "aggressive");
    expect(aggressive).toBe(normal); // charging's three-putt is on you, not bad luck
  });

  it("only three-putts trigger it — a safe two-putt is unaffected", () => {
    const safeTwo = puttNote("twoputt", "long", 20, at0, "safe");
    const normalTwo = puttNote("twoputt", "long", 20, at0, "normal");
    expect(safeTwo).toBe(normalTwo);
  });
});
