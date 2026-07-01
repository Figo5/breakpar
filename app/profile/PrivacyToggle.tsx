"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner-only privacy control on the profile page. Shows the public-disclosure
 * line (so default-public is never a surprise) and flips profilePublic via the
 * owner-only PATCH route. Optimistic-ish: disables while saving, then refreshes
 * the server component so the whole page reflects the new state.
 */
export function PrivacyToggle({ username, isPublic }: { username: string; isPublic: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  async function toggle() {
    if (saving) return;
    setSaving(true);
    setErr(false);
    try {
      const res = await fetch("/api/profile/privacy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public: !isPublic }),
      });
      if (!res.ok) throw new Error("privacy");
      router.refresh();
    } catch {
      setErr(true);
      setSaving(false);
    }
  }

  return (
    <div className="privacy-box">
      <div className="privacy-copy">
        {isPublic ? (
          <>
            Your profile is public at <strong>breakpar.xyz/u/{username}</strong> — anyone can see
            your stats &amp; trophies.
          </>
        ) : (
          <>Your profile is <strong>private</strong> — only you can see it. Make it public to appear at breakpar.xyz/u/{username}.</>
        )}
      </div>
      <button className="cta ghost" onClick={toggle} disabled={saving}>
        {saving ? "Saving…" : isPublic ? "Make private" : "Make public"}
      </button>
      {err && <div className="fb-err">Couldn&apos;t update. Tap to retry.</div>}
    </div>
  );
}
