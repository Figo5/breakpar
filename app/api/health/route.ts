import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Liveness + DB readiness probe for uptime monitors / load balancers.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up" });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
