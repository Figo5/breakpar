import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";

const KINDS = new Set(["bug", "course", "general"]);
const MAX_MESSAGE = 2000;
const MAX_EMAIL = 200;

// POST: submit a piece of feedback (bug report, course request, or general).
// Anonymous-friendly — no sign-in required. Stored in the Feedback table.
export const POST = route(async (req: Request) => {
  const limited = await rateLimit("feedback", 5, 60_000); // 5/min per caller
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    kind?: string;
    email?: string;
  };

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (message.length > MAX_MESSAGE)
    return NextResponse.json({ error: "too-long" }, { status: 400 });

  const kind = KINDS.has(body.kind ?? "") ? body.kind! : "general";
  const email = (body.email ?? "").trim().slice(0, MAX_EMAIL) || null;

  // Best-effort attribution — never blocks the submission.
  const user = await getCurrentUser().catch(() => null);
  const path = (await headers()).get("referer") ?? null;

  await prisma.feedback.create({
    data: { userId: user?.id ?? null, kind, message, email, path },
  });

  return NextResponse.json({ ok: true });
});
