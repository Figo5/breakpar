import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/career/tick/route";

// The auth guard runs before any DB access, so these assertions need no database.
describe("Career tick route auth", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("rejects a request with no authorization when CRON_SECRET is set", async () => {
    const response = await GET(new Request("https://example.com/api/career/tick"), undefined as never);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(
      new Request("https://example.com/api/career/tick", {
        headers: { authorization: "Bearer wrong" },
      }),
      undefined as never,
    );
    expect(response.status).toBe(401);
  });
});
