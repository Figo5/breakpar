import { NextResponse } from "next/server";

/** Cron endpoints may stay open in local development for manual recovery, but
 * production must fail closed when CRON_SECRET is absent or incorrect. */
export function cronAuthorizationError(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const production = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

  if (!secret) {
    return production
      ? NextResponse.json({ error: "cron-secret-missing" }, { status: 503 })
      : null;
  }

  return req.headers.get("authorization") === `Bearer ${secret}`
    ? null
    : NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
