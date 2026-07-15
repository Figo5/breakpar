import type { PuttContext } from "@/lib/engine/shots";

/**
 * Glanceable top-down green for the putting stage: your ball, the cup, and the
 * break (a curved line). The numbers come from the server (derived from the
 * shot seed), so it's stable on replay. Renders in the same 680x560 reference
 * card slot as HoleArt, with the same baked top/bottom scrims — the
 * distance/break/speed read out via the page-level cues in the controls, not
 * an overlay owned by this component.
 */
export function PuttView({ putt }: { putt: PuttContext }) {
  const { breakDir } = putt;

  // Cup near the top; ball lower for longer putts.
  const cup = { x: 340, y: 240 };
  const far = putt.bucket === "long";
  const ball = { x: 340, y: far ? 600 : 520 };

  // Break: bow the putt line left or right.
  const bow = breakDir === "L" ? -80 : breakDir === "R" ? 80 : 0;
  const midX = 340 + bow;
  const midY = (cup.y + ball.y) / 2;
  const line = `M${ball.x} ${ball.y} Q ${midX} ${midY} ${cup.x} ${cup.y}`;

  return (
    <svg viewBox="0 0 680 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="grn" cx="50%" cy="40%" r="72%">
          <stop offset="0" stopColor="#3f9e6b" />
          <stop offset="1" stopColor="#2d6a4f" />
        </radialGradient>
        <linearGradient id="pvScrimT" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#152418" stopOpacity=".62" />
          <stop offset="100%" stopColor="#152418" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pvScrimB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#152418" stopOpacity="0" />
          <stop offset="45%" stopColor="#152418" stopOpacity=".5" />
          <stop offset="100%" stopColor="#152418" stopOpacity=".9" />
        </linearGradient>
      </defs>

      <g transform="scale(1 0.6829268293)">
      <rect width="680" height="820" fill="#bfe0bf" />

      {/* Green surface — fills most of the card */}
      <ellipse cx="340" cy="410" rx="330" ry="340" fill="url(#grn)" />

      {/* Subtle contour rings to suggest slope */}
      <ellipse cx="340" cy="410" rx="232" ry="238" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="3" />
      <ellipse cx="340" cy="410" rx="124" ry="127" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="3" />

      {/* Putt line (with break) */}
      <path d={line} fill="none" stroke="rgba(247,243,232,.85)" strokeWidth="5" strokeDasharray="8 15" />

      {/* Cup + flag */}
      <ellipse cx={cup.x} cy={cup.y} rx="15" ry="9" fill="#13201a" />
      <line x1={cup.x} y1={cup.y} x2={cup.x} y2={cup.y - 80} stroke="#13201a" strokeWidth="5" />
      <path d={`M${cup.x} ${cup.y - 80} L ${cup.x + 50} ${cup.y - 66} L ${cup.x} ${cup.y - 54} Z`} fill="#d7402f" />

      {/* Ball */}
      <circle cx={ball.x} cy={ball.y} r="16" fill="#fbf8ef" stroke="#13201a" strokeWidth="3" />

      <rect x="0" y="0" width="680" height="190" fill="url(#pvScrimT)" />
      <rect x="0" y="430" width="680" height="390" fill="url(#pvScrimB)" />
      </g>
    </svg>
  );
}
