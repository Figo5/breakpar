import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { prisma } from "@/lib/db";
import { isAdmin, adminConfigured } from "@/lib/admin";
import { FeedbackList, type FeedbackItem } from "./FeedbackList";

export const dynamic = "force-dynamic";

// Admin inbox for feedback. Gated by ADMIN_EMAILS (see lib/admin.ts).
export default async function AdminFeedback() {
  const ok = await isAdmin();

  if (!ok) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="eyebrow">Admin</div>
          <div className="acct">
            <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
            <SignedOut>
              <SignInButton mode="modal"><button className="acct-link">Sign in</button></SignInButton>
            </SignedOut>
          </div>
        </div>
        <div className="spacer" />
        <div className="tagline" style={{ textAlign: "center" }}>
          {!adminConfigured()
            ? "No admins configured. Set ADMIN_USERNAMES to enable this page."
            : "You don't have access to this page."}
        </div>
        <Link href="/" className="cta ghost" style={{ marginTop: 16 }}>Back to today</Link>
        <div className="spacer" />
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
        <div className="acct"><UserButton afterSignOutUrl="/" /></div>
      </div>
      <div className="wordmark" style={{ fontSize: "clamp(34px,10vw,46px)" }}>Inbox</div>
      <div className="tagline">{open} open · {rows.length} total</div>

      <FeedbackList items={items} />

      <Link href="/" className="cta ghost" style={{ marginTop: 18 }}>Back to today</Link>
    </div>
  );
}
