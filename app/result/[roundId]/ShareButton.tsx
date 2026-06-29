"use client";
import { useState } from "react";
import { track, type RoundMeta } from "@/lib/analytics";

export function ShareButton({ text, meta }: { text: string; meta: RoundMeta }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        track.shareClicked(meta, "native");
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(text);
    track.shareClicked(meta, "clipboard");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return <button className="cta" onClick={share}>{copied ? "Copied ✓" : "Share result"}</button>;
}
