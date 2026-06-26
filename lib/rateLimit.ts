import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";

/**
 * Minimal fixed-window rate limiter.
 *
 * NOTE: this is an in-memory limiter — it only sees one serverless instance, so
 * it's a basic abuse speed-bump, not a hard global guarantee. For real
 * multi-instance production, swap the Map for Upstash Ratelimit (Redis) keeping
 * the same `limit()` signature. Good enough to stop trivial spamming locally.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function limit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

/** Best-effort caller identity: guest cookie if present, else client IP. */
export async function callerKey(): Promise<string> {
  const guest = (await cookies()).get("bp_guest")?.value;
  if (guest) return `g:${guest}`;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `ip:${ip}`;
}

/** Returns a 429 response if over the limit, else null. */
export async function rateLimit(scope: string, max: number, windowMs: number): Promise<NextResponse | null> {
  const key = `${scope}:${await callerKey()}`;
  if (limit(key, max, windowMs)) return null;
  return NextResponse.json({ error: "rate-limited" }, { status: 429 });
}
