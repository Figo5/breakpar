import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  adminConfigured,
  adminToken,
  checkPassword,
} from "@/lib/admin";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";

// POST: exchange the admin password for a session cookie.
export const POST = route(async (req: Request) => {
  const limited = await rateLimit("admin-login", 10, 60_000); // 10/min
  if (limited) return limited;

  if (!adminConfigured())
    return NextResponse.json({ error: "not-configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!checkPassword((body.password ?? "").trim()))
    return NextResponse.json({ error: "wrong-password" }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminToken()!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
});

// DELETE: sign out of the admin area.
export const DELETE = route(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
