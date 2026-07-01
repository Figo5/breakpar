import { describe, it, expect } from "vitest";
import { bestByCourse, buildRecords, type RoundLite } from "@/lib/hallOfFame";
import { COURSES } from "@/data/courses";

const A = COURSES[0].slug; // pebble-beach
const B = COURSES[1].slug; // st-andrews-old

function row(over: Partial<RoundLite> & { courseSlug: string; relativeToPar: number }): RoundLite {
  return {
    id: over.id ?? `${over.courseSlug}-${over.relativeToPar}`,
    mode: over.mode ?? "unlimited",
    dateKey: over.dateKey ?? null,
    score: over.score ?? 72 + over.relativeToPar,
    durationMs: over.durationMs ?? 60_000,
    playedAt: over.playedAt ?? new Date("2026-06-25T12:00:00Z"),
    ...over,
  };
}

describe("hall of fame — bestByCourse", () => {
  it("keeps the lowest relative-to-par per course", () => {
    const best = bestByCourse([
      row({ courseSlug: A, relativeToPar: 2 }),
      row({ courseSlug: A, relativeToPar: -3 }),
      row({ courseSlug: A, relativeToPar: 1 }),
      row({ courseSlug: B, relativeToPar: 0 }),
    ]);
    expect(best.get(A)!.relativeToPar).toBe(-3);
    expect(best.get(B)!.relativeToPar).toBe(0);
  });

  it("breaks ties on faster duration", () => {
    const best = bestByCourse([
      row({ courseSlug: A, relativeToPar: -1, durationMs: 90_000, id: "slow" }),
      row({ courseSlug: A, relativeToPar: -1, durationMs: 40_000, id: "fast" }),
    ]);
    expect(best.get(A)!.id).toBe("fast");
  });

  it("treats a null duration as slowest (loses the tie)", () => {
    const best = bestByCourse([
      row({ courseSlug: A, relativeToPar: -1, durationMs: null, id: "nulldur" }),
      row({ courseSlug: A, relativeToPar: -1, durationMs: 80_000, id: "timed" }),
    ]);
    expect(best.get(A)!.id).toBe("timed");
  });

  it("mixes daily and unlimited — best card wins regardless of mode", () => {
    const best = bestByCourse([
      row({ courseSlug: A, relativeToPar: 3, mode: "unlimited" }),
      row({ courseSlug: A, relativeToPar: -2, mode: "daily", dateKey: "2026-06-25" }),
    ]);
    expect(best.get(A)!.mode).toBe("daily");
    expect(best.get(A)!.relativeToPar).toBe(-2);
  });
});

describe("hall of fame — buildRecords", () => {
  it("emits one slot for every catalogue course", () => {
    const records = buildRecords(new Map());
    expect(records.length).toBe(COURSES.length);
    expect(records.every((r) => !r.played)).toBe(true);
  });

  it("conquered courses come first, best-to-par on top; unplayed are open slots", () => {
    const best = bestByCourse([
      row({ courseSlug: A, relativeToPar: 2 }),
      row({ courseSlug: B, relativeToPar: -4 }),
    ]);
    const records = buildRecords(best);
    // played first
    expect(records[0].played && records[1].played).toBe(true);
    // best card (lower rel) on top
    expect(records[0].slug).toBe(B);
    expect(records[0].relativeToPar).toBe(-4);
    expect(records[1].slug).toBe(A);
    // rest are open slots
    expect(records.slice(2).every((r) => !r.played)).toBe(true);
    const open = records.find((r) => !r.played)!;
    expect(open.roundId).toBeNull();
    expect(open.relativeToPar).toBeNull();
  });

  it("carries the winning round's metadata onto the record", () => {
    const best = bestByCourse([
      row({ courseSlug: A, relativeToPar: -1, mode: "daily", dateKey: "2026-06-25", id: "r1" }),
    ]);
    const rec = buildRecords(best).find((r) => r.slug === A)!;
    expect(rec.roundId).toBe("r1");
    expect(rec.mode).toBe("daily");
    expect(rec.puzzleNo).toBe(1); // 2026-06-25 is puzzle #1
    expect(rec.achievedAt).toBeTypeOf("string");
  });
});
