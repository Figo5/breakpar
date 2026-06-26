import Link from "next/link";
import { prisma } from "@/lib/db";
import { isAdmin, adminConfigured } from "@/lib/admin";
import { FeedbackList, type FeedbackItem } from "./FeedbackList";
import { AdminLogin, AdminLogout } from "./AdminLogin";

export const dynamic = "force-dynamic";

// Admin inbox for feedback. Protected by a password login (see lib/admin.ts).
export default async function AdminFeedback() {
  if (!(await isAdmin())) {
    return (
      <div className="screen">
        <div className="eyebrow">Admin · Feedback</div>
        <AdminLogin configured={adminConfigured()} />
        <Link href="/" className="cta ghost" style={{ marginTop: 16 }}>Back to today</Link>
      </div>
    );
  }

  const rows = await prisma.feedback.findMany({
    orderBy: [{ resolved: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const open = rows.filter((r) => !r.resolved).length;

  const items: FeedbackItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    email: r.email,
    path: r.path,
    resolved: r.resolved,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Admin · Feedback</div>
        <AdminLogout />
      </div>
      <div className="wordmark" style={{ fontSize: "clamp(34px,10vw,46px)" }}>Inbox</div>
      <div className="tagline">{open} open · {rows.length} total</div>

      <FeedbackList items={items} />

      <Link href="/" className="cta ghost" style={{ marginTop: 18 }}>Back to today</Link>
    </div>
  );
}
