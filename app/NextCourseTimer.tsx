"use client";
import { useEffect, useState } from "react";

/** Counts down to the next UTC midnight, when a new daily course drops. */
export function NextCourseTimer() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      );
      const ms = next - now.getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      setLabel(`${pad(h)}:${pad(m)}:${pad(s)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="timer-mono">{label || "--:--:--"}</span>;
}
