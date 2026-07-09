import { describe, it, expect } from "vitest";
import { CHANGELOG } from "@/data/changelog";

// Guards the changelog stays well-formed as entries get added over time.
// These catch the mistakes you'd actually make when shipping in a hurry.
describe("changelog", () => {
  it("is not empty", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it("every date is a valid ISO YYYY-MM-DD", () => {
    for (const e of CHANGELOG) {
      expect(e.date, `bad date: ${e.date}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const [y, m, d] = e.date.split("-").map(Number);
      const parsed = new Date(Date.UTC(y, m - 1, d));
      expect(parsed.getUTCFullYear(), `unreal date: ${e.date}`).toBe(y);
      expect(parsed.getUTCMonth() + 1, `unreal date: ${e.date}`).toBe(m);
      expect(parsed.getUTCDate(), `unreal date: ${e.date}`).toBe(d);
    }
  });

  it("dates are unique", () => {
    const dates = CHANGELOG.map((e) => e.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("is ordered newest-first", () => {
    const dates = CHANGELOG.map((e) => e.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it("every entry has at least one item, and no item is blank", () => {
    for (const e of CHANGELOG) {
      expect(e.items.length, `no items on ${e.date}`).toBeGreaterThan(0);
      for (const item of e.items) {
        expect(item.trim().length, `blank item on ${e.date}`).toBeGreaterThan(0);
      }
    }
  });
});
