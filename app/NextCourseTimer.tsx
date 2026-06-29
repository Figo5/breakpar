"use client";
import { useEffect, useState } from "react";
import { nextRollover } from "@/lib/daily";

/** Counts down to the next daily rollover (midnight America/New_York), driven
 * by the SAME boundary definition as lib/daily.ts so the timer and the actual
 * course change always agree. */
export function NextCourseTimer() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, nextRollover().getTime() - Date.now());
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
