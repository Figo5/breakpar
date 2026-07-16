import { describe, expect, it } from "vitest";
import { coastalPenaltyPosition, pickDryBallPosition, pointClearsEllipse } from "../lib/holeMapPosition";

describe("missed-green map position", () => {
  const candidates = [
    { x: 290, y: 305 }, // preferred front-left lie
    { x: 390, y: 305 },
    { x: 240, y: 250 },
  ];

  it("keeps the preferred front-fringe lie when there is no water", () => {
    expect(pickDryBallPosition(candidates, null)).toEqual(candidates[0]);
  });

  it("moves a missed-green ball out of a front water hazard", () => {
    const water = { x: 310, y: 305, rx: 70, ry: 35 };
    const picked = pickDryBallPosition(candidates, water);

    expect(picked).toEqual(candidates[2]);
    expect(pointClearsEllipse(picked, water)).toBe(true);
  });

  it("moves a fairway marker along its route when cross-water covers it", () => {
    const fairwayCandidates = [
      { x: 340, y: 300 },
      { x: 340, y: 265 },
      { x: 340, y: 230 },
    ];
    const water = { x: 340, y: 300, rx: 120, ry: 38 };

    const picked = pickDryBallPosition(fairwayCandidates, water);

    expect(picked).toEqual(fairwayCandidates[2]);
    expect(pointClearsEllipse(picked, water)).toBe(true);
  });
});

describe("coastal penalty position", () => {
  it("keeps an ocean miss level with the shot instead of sending it back to the tee", () => {
    expect(coastalPenaltyPosition({ x: 390, y: 188 }, "right"))
      .toEqual({ x: 608, y: 188 });
  });

  it("keeps the marker inside the visible map", () => {
    expect(coastalPenaltyPosition({ x: 340, y: 30 }, "left"))
      .toEqual({ x: 72, y: 82 });
  });
});
