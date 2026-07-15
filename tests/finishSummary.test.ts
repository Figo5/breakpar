import { describe, expect, it } from "vitest";
import { finishSummary } from "@/lib/finishSummary";
import type { ShotRecord } from "@/lib/engine/shots";

const putt = (puttResult: "oneputt" | "twoputt" | "threeputt"): ShotRecord => ({
  index: 2,
  stage: "putt",
  decision: "normal",
  puttResult,
  event: null,
  note: "",
});

describe("finishSummary", () => {
  it("makes a par-5 three-putt par explicit", () => {
    expect(finishSummary([putt("threeputt")], "par")).toBe("Three-putt par");
  });

  it("labels the other reached-in-two finishes clearly", () => {
    expect(finishSummary([putt("oneputt")], "eagle")).toBe("One-putt eagle");
    expect(finishSummary([putt("twoputt")], "birdie")).toBe("Two-putt birdie");
  });

  it("leaves non-putt finishes to their existing narration", () => {
    const scramble: ShotRecord = { index: 2, stage: "scramble", decision: "normal", scrambleResult: "updown", event: null, note: "" };
    expect(finishSummary([scramble], "par")).toBeNull();
  });
});
