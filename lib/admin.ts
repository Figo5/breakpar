import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Simple password gate for the admin area. Set ADMIN_PASSWORD in the env; the
 * /admin login form posts it, and on success we drop a signed cookie holding a
 * token derived from the password (never the password itself). No Clerk needed.
 */
export const ADMIN_COOKIE = "bp_admin";
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function adminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD?.trim();
  return p && p.length > 0 ? p : null;
}

export function adminConfigured(): boolean {
  return adminPassword() !== null;
}

/** Deterministic session token for the configured password. */
export function adminToken(): string | null {
  const pw = adminPassword();
  if (!pw) return null;
  const secret = process.env.SERVER_SEED ?? "break-par-admin";
  return createHmac("sha256", secret).update(`admin:${pw}`).digest("hex");
}

/** Constant-time compare of two hex strings of equal length. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** True if the supplied password matches ADMIN_PASSWORD. */
export function checkPassword(input: string): boolean {
  const pw = adminPassword();
  if (!pw) return false;
  return safeEqual(input, pw);
}

/** True if the current request carries a valid admin cookie. */
export async function isAdmin(): Promise<boolean> {
  const want = adminToken();
  if (!want) return false;
  const got = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return safeEqual(got, want);
}
