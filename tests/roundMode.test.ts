import { describe, expect, it } from "vitest";
import { roundModeLabel } from "@/lib/roundMode";

describe("roundModeLabel", () => {
  it("keeps each game mode distinct", () => {
    expect(roundModeLabel("daily", 42)).toBe("#42");
    expect(roundModeLabel("daily")).toBe("Daily");
    expect(roundModeLabel("unlimited")).toBe("Practice");
    expect(roundModeLabel("challenge")).toBe("Challenge");
    expect(roundModeLabel("tournament")).toBe("Tournament");
    expect(roundModeLabel("career")).toBe("Career");
  });

  it("does not mislabel an unknown future mode as practice", () => {
    expect(roundModeLabel("future-mode")).toBe("Round");
  });
});
