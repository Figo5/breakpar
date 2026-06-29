import type { PuttContext } from "@/lib/engine/shots";

/**
 * Glanceable top-down green for the putting stage: your ball, the cup, the
 * distance, the break (a curved arrow) and the green speed. Purely visual — the
 * numbers come from the server (derived from the shot seed), so it's stable on
 * replay. Mirrors HoleArt's stylized look.
 */
export function PuttView({ putt }: { putt: PuttContext }) {
  const { distanceFt, breakDir, slope, speed } = putt;
  const slick = speed === "Fast" || speed === "Firm";

  // Ball sits lower for longer putts; cup near the top.
  const cup = { x: 200, y: 34 };
  const far = putt.bucket === "long";
  const ball = { x: 200, y: far ? 128 : 104 };

  // Break: bow the putt line left or right.
  const bow = breakDir === "L" ? -34 : breakDir === "R" ? 34 : 0;
  const midX = 200 + bow;
  const midY = (cup.y + ball.y) / 2;
  const line = `M${ball.x} ${ball.y} Q ${midX} ${midY} ${cup.x} ${cup.y}`;

  return (
    <div className="hole-art putt-view" style={{ background: "linear-gradient(180deg,#cfe7cf,#bfe0bf)" }}>
      <svg viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <radialGradient id="grn" cx="50%" cy="40%" r="70%">
            <stop offset="0" stopColor="#3f9e6b" />
            <stop offset="1" stopColor="#2d6a4f" />
          </radialGradient>
        </defs>

        {/* Green surface */}
        <ellipse cx="200" cy="84" rx="172" ry="72" fill="url(#grn)" />

        {/* Subtle contour rings to suggest slope */}
        <ellipse cx="200" cy="84" rx="120" ry="48" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="1.5" />
        <ellipse cx="200" cy="84" rx="64" ry="26" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="1.5" />

        {/* Putt line (with break) */}
        <path d={line} fill="none" stroke="rgba(247,243,232,.85)" strokeWidth="2.5" strokeDasharray="4 7" />

        {/* Cup + flag */}
        <ellipse cx={cup.x} cy={cup.y} rx="7" ry="4" fill="#13201a" />
        <line x1={cup.x} y1={cup.y} x2={cup.x} y2={cup.y - 30} stroke="#13201a" strokeWidth="2.5" />
        <path d={`M${cup.x} ${cup.y - 30} L ${cup.x + 20} ${cup.y - 25} L ${cup.x} ${cup.y - 20} Z`} fill="#d7402f" />

        {/* Ball */}
        <circle cx={ball.x} cy={ball.y} r="6.5" fill="#fbf8ef" stroke="#13201a" strokeWidth="1.2" />
      </svg>

      <div className="wind-tag">
        ⛳ {distanceFt} ft · {slick ? "slick" : "true"} {speed.toLowerCase()} greens
      </div>
      <div className="putt-break">
        {slope === "downhill" ? "⏬ downhill" : slope === "uphill" ? "⏫ uphill" : "▦ flat"}
        {" · "}
        {breakDir === "L" ? "breaks ◀ R-to-L" : breakDir === "R" ? "breaks L-to-R ▶" : "dead straight"}
      </div>
    </div>
  );
}
