"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SignUpButton } from "@clerk/nextjs";
import { nextMonday } from "@/lib/daily";

/**
 * Home-screen teaser for the first weekly tournament (Monday 00:00 Eastern).
 * UI ONLY — deliberately disabled/greyed, links NOWHERE (no route exists yet),
 * and carries accounts-only messaging to drive sign-ups.
 *
 * The countdown target is computed by lib/daily.nextMonday() (DST-safe Eastern
 * midnight, same machinery as the daily rollover) — never a hardcoded timestamp.
 * `isAccount` is passed from the server (like the Friends/Challenges nav gating)
 * so the guest-vs-member messaging is stable in SSR with no Clerk hydration flash.
 */
export function TournamentTeaser({ isAccount }: { isAccount: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState("");

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, nextMonday().getTime() - Date.now());
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setLabel(`${d}d ${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="tease" aria-label="Weekly Tournaments — coming Monday">
      <div className="tease-head">
        <h3>🏆 Weekly Tournaments</h3>
        <span className="tease-soon">Soon</span>
      </div>
      <div className="tease-count">
        First tournament starts in <b>{label || "—"}</b>
      </div>
      <div className="tease-sub">
        One course, 4 rounds, a cut, and a trophy for the winner. Accounts only.
      </div>

      {/* The tournament page now exists (self-activating). The button navigates
          there — before Monday it shows the countdown + join; during the week,
          live rounds. */}
      <button
        type="button"
        className="tease-btn"
        onClick={() => router.push("/tournament")}
      >
        🏆 View tournament
      </button>

      {isAccount ? (
        <div className="tease-ready">✓ You&apos;re all set — see you Monday.</div>
      ) : (
        <SignUpButton mode="modal">
          <button className="cta green">Create a free account to play</button>
        </SignUpButton>
      )}
    </div>
  );
}
