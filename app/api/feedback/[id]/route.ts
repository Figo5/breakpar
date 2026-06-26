import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { route } from "@/lib/api";

// PATCH: toggle a feedback item's resolved flag. Admin-only.
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { resolved?: boolean };
  const resolved = body.resolved ?? true;

  await prisma.feedback.update({ where: { id }, data: { resolved } });
  return NextResponse.json({ ok: true, resolved });
});

// DELETE: remove a feedback item (spam/handled). Admin-only.
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  await prisma.feedback.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
