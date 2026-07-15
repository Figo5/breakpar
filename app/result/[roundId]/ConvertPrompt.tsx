"use client";
import { useEffect, useState } from "react";
import { SignUpButton } from "@clerk/nextjs";

/**
 * Guest → account nudge on the result screen. Rendered ONLY for signed-out
 * guests on their own round (the server gates on clerkId + ownRound, so this
 * component never mounts for logged-in users). Copy is streak-anchored on daily
 * rounds, Hall-of-Fame-anchored on practice. Dismissible, once per session
 * (sessionStorage), and renders nothing until the effect confirms it's not
 * already dismissed so there's no flash.
 */
export function ConvertPrompt({
  variant,
  streak,
}: {
  variant: "daily" | "practice";
  streak: number; // current day-streak (daily only; ignored for practice)
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) !== "1") setShow(true);
    } catch {
      setShow(true); // storage blocked (private mode edge) — still show once
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setShow(false);
  };

  const daily = variant === "daily";
  const headline = daily
    ? streak >= 2
      ? `${streak}-day streak — don't lose it.`
      : "Streak started — save it."
    : "Save this round to your Hall of Fame.";
  const body = daily
    ? "Create a free account to keep your streak, rounds & Hall of Fame across devices."
    : "Create a free account to keep your records & rounds across devices.";
  const button = daily ? "Save my streak" : "Save to Hall of Fame";

  return (
    <div className="convert">
      <button className="convert-x" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
      <div className="convert-head">{headline}</div>
      <div className="convert-body">{body}</div>
      <SignUpButton mode="modal">
        <button className="convert-cta" onClick={dismiss}>
          {button}
        </button>
      </SignUpButton>
    </div>
  );
}

const DISMISS_KEY = "bp_convert_dismissed";
