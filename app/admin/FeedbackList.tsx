"use client";

import { useState } from "react";

export interface FeedbackItem {
  id: string;
  kind: string;
  message: string;
  email: string | null;
  path: string | null;
  resolved: boolean;
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = {
  course: "Course request",
  bug: "Bug",
  general: "General",
};

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  const [list, setList] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(item: FeedbackItem) {
    setBusy(item.id);
    const next = !item.resolved;
    try {
      const res = await fetch(`/api/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolved: next }),
      });
      if (!res.ok) throw new Error();
      setList((l) => l.map((x) => (x.id === item.id ? { ...x, resolved: next } : x)));
    } catch {
      /* leave state unchanged on failure */
    } finally {
      setBusy(null);
    }
  }

  async function remove(item: FeedbackItem) {
    if (!confirm("Delete this feedback permanently?")) return;
    setBusy(item.id);
    try {
      const res = await fetch(`/api/feedback/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setList((l) => l.filter((x) => x.id !== item.id));
    } catch {
      /* keep on failure */
    } finally {
      setBusy(null);
    }
  }

  if (list.length === 0) {
    return <div className="profile-empty">No feedback yet.</div>;
  }

  return (
    <div className="fb-list">
      {list.map((item) => (
        <div key={item.id} className={`fb-item ${item.resolved ? "done" : ""}`}>
          <div className="fb-item-top">
            <span className={`fb-badge k-${item.kind}`}>{KIND_LABEL[item.kind] ?? item.kind}</span>
            <span className="fb-when">
              {new Date(item.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="fb-msg">{item.message}</div>
          <div className="fb-meta">
            {item.email ? (
              <a href={`mailto:${item.email}`} className="fb-mail">{item.email}</a>
            ) : (
              <span className="fb-anon">no email</span>
            )}
            {item.path && <span className="fb-path">{prettyPath(item.path)}</span>}
          </div>
          <div className="fb-actions">
            <button className="fb-act" disabled={busy === item.id} onClick={() => toggle(item)}>
              {item.resolved ? "Reopen" : "Mark resolved"}
            </button>
            <button className="fb-act danger" disabled={busy === item.id} onClick={() => remove(item)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function prettyPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
