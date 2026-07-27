import { describe, expect, it } from "vitest";

import { careerWorkIsPending, type CareerWorkPending } from "@/lib/career/repair";

function work(overrides: Partial<CareerWorkPending> = {}): CareerWorkPending {
  const base = {
    seasonsUnlocked: 0,
    eventsToClose: 0,
    eventsEndedUnsettled: 0,
    seasonsToClose: 0,
    cohortsEndedUnsettled: 0,
    seasonsMissingSuccessor: 0,
    championshipsFieldPending: 0,
    championshipsToClose: 0,
    championshipsEndedUnsettled: 0,
    retryableAttempts: 0,
    ...overrides,
  };
  const total = Object.values(base).reduce((sum, value) => sum + value, 0);
  return { ...base, total };
}

describe("careerWorkIsPending", () => {
  it("is false when nothing is overdue", () => {
    expect(careerWorkIsPending(work())).toBe(false);
  });

  it("is true when any single category has pending work", () => {
    expect(careerWorkIsPending(work({ cohortsEndedUnsettled: 1 }))).toBe(true);
    expect(careerWorkIsPending(work({ seasonsUnlocked: 3 }))).toBe(true);
    expect(careerWorkIsPending(work({ seasonsMissingSuccessor: 1 }))).toBe(true);
    expect(careerWorkIsPending(work({ championshipsEndedUnsettled: 2 }))).toBe(true);
    expect(careerWorkIsPending(work({ retryableAttempts: 1 }))).toBe(true);
  });
});
