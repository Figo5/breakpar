"use client";
import { useEffect, useState } from "react";
import { SignUpButton } from "@clerk/nextjs";
import { TIER_META, type TrophyTier } from "@/lib/trophies";

/**
 * "🎉 You just earned…" celebration on the result screen. Reads the newly-
 * unlocked trophies the play page stashed in sessionStorage keyed by roundId,
 * shows them once, then clears the key — so it fires only for the finisher, and
 * never on a shared link or a re-visit. Guests get an appended conversion hook
 * (awards live on the durable row and transfer on sign-up). Dismissible.
 */
export function TrophyToast({ roundId, signedIn }: { roundId: string; signedIn: boolean }) {
  const [trophies, setTrophies] = useState<NewTrophy[] | null>(null);

  useEffect(() => {
    const key = `bp_new_trophies_${roundId}`;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      sessionStorage.removeItem(key); // show once
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) setTrophies(parsed);
    } catch {
      /* storage blocked or bad JSON — just don't celebrate */
    }
  }, [roundId]);

  if (!trophies || trophies.length === 0) return null;

  const names = trophies.map((t) => t.label).join(", ");

  return (
    <div className="trophy-toast">
      <button className="convert-x" onClick={() => setTrophies(null)} aria-label="Dismiss">
        ×
      </button>
      <div className="tt-head">🎉 {trophies.length > 1 ? "Trophies unlocked!" : "Trophy unlocked!"}</div>
      <div className="tt-list">
        {trophies.map((t) => (
          <span key={t.id} className={`tt-badge t-${t.tier}`}>
            {TIER_ICON[t.tier] ?? "🏅"} {t.label}
            <em>{TIER_META[t.tier]?.label ?? ""}</em>
          </span>
        ))}
      </div>
      {!signedIn && (
        <SignUpButton mode="modal">
          <button className="convert-cta" onClick={() => setTrophies(null)}>
            Create a free account to keep {trophies.length > 1 ? "them" : names}
          </button>
        </SignUpButton>
      )}
    </div>
  );
}

interface NewTrophy {
  id: string;
  label: string;
  tier: TrophyTier;
}

const TIER_ICON: Record<TrophyTier, string> = {
  common: "🎖️",
  rare: "🏅",
  elite: "🏆",
  legendary: "👑",
  special: "✦",
};
