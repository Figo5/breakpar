"use client";
import { useState } from "react";

export function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return <button className="cta" onClick={share}>{copied ? "Copied ✓" : "Share result"}</button>;
}
