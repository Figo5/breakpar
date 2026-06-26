"use client";

import { useState } from "react";

type Kind = "course" | "bug" | "general";
const KINDS: { id: Kind; label: string }[] = [
  { id: "course", label: "Request a course" },
  { id: "bug", label: "Report a bug" },
  { id: "general", label: "General" },
];

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("course");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  function close() {
    setOpen(false);
    // Reset after the dialog animates out.
    setTimeout(() => {
      setState("idle");
      setMessage("");
      setEmail("");
      setKind("course");
    }, 200);
  }

  async function submit() {
    if (!message.trim() || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, message: message.trim(), email: email.trim() }),
      });
      if (!res.ok) throw new Error("send");
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        className="fb-fab"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send feedback"
      >
        💬
      </button>

      {open && (
        <div className="fb-overlay" role="dialog" aria-modal="true" aria-label="Send feedback" onClick={close}>
          <div className="fb-sheet" onClick={(e) => e.stopPropagation()}>
            {state === "done" ? (
              <div className="fb-done">
                <div className="fb-done-emoji">✅</div>
                <h3>Thanks!</h3>
                <p>Got it — we read every message.</p>
                <button className="cta" onClick={close}>Close</button>
              </div>
            ) : (
              <>
                <div className="fb-head">
                  <h3>Feedback</h3>
                  <button className="fb-x" onClick={close} aria-label="Close">✕</button>
                </div>
                <p className="fb-sub">Request a course, report a bug, or tell us anything.</p>

                <div className="fb-kinds">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      className={`fb-kind ${kind === k.id ? "on" : ""}`}
                      onClick={() => setKind(k.id)}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>

                <textarea
                  className="fb-text"
                  placeholder={
                    kind === "course"
                      ? "Which course would you like to see? Any details help."
                      : kind === "bug"
                        ? "What happened? What did you expect?"
                        : "What's on your mind?"
                  }
                  value={message}
                  maxLength={2000}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                />

                <input
                  className="fb-email"
                  type="email"
                  placeholder="Email (optional, if you want a reply)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                {state === "error" && (
                  <div className="fb-err">Couldn&apos;t send that. Please try again.</div>
                )}

                <button
                  className="cta"
                  onClick={submit}
                  disabled={!message.trim() || state === "sending"}
                >
                  {state === "sending" ? "Sending…" : "Send feedback"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
