import type { CourseHole } from "@/data/courses";

/**
 * Stylized, hole-specific layout diagram. The routing (dogleg direction),
 * length (par) and hazard (sand / water / ocean) are driven by the real
 * per-hole data, so each hole looks distinct. It's an artistic top-down
 * representation, not a licensed aerial image.
 */
export function HoleArt({ hole, wind, windDir, greens }: {
  hole: CourseHole; wind: number; windDir: number; greens: string;
}) {
  const { par, dogleg, hazard, signature } = hole;
  const long = par === 5;
  const short = par === 3;

  // Green vertical position by dogleg (L bends up, R bends down, S stays level).
  const greenY = dogleg === "L" ? 46 : dogleg === "R" ? 104 : 72;
  const gx = 348; // green x
  // Bend control point — exaggerated for par 5s, flattened for par 3s.
  const bend = short ? 0 : long ? 34 : 22;
  const midY = dogleg === "L" ? 96 - bend : dogleg === "R" ? 96 + bend : 96;
  const teeY = 104;

  // Fairway ribbon: tee (left) -> bend -> green (right), with a return edge.
  const fairway = `M22 ${teeY - 8}
    C 130 ${midY - 8}, 250 ${greenY - 6}, ${gx} ${greenY - 6}
    L ${gx} ${greenY + 14}
    C 250 ${midY + 16}, 130 ${midY + 16}, 22 ${teeY + 8} Z`;

  const isOcean = hazard === "ocean";
  const isWater = hazard === "water";
  const isSand = hazard === "sand";
  const sky =
    isOcean ? "linear-gradient(180deg,#bfe3ef,#a9d6e8)" : "linear-gradient(180deg,#dff0df,#cfe7cf)";

  return (
    <div className="hole-art" style={{ background: sky }}>
      <svg viewBox="0 0 400 150" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="fw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5fae74" />
            <stop offset="1" stopColor="#46955f" />
          </linearGradient>
          <linearGradient id="wtr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3f8fd0" />
            <stop offset="1" stopColor="#2f6fa8" />
          </linearGradient>
        </defs>

        <rect width="400" height="150" fill={isOcean ? "#a9d6e8" : "#cfe7cf"} />

        {/* Ocean fills the lower band; water holes get a pond guarding the green. */}
        {isOcean && (
          <path d="M0 150 L0 118 C 110 132, 240 138, 400 120 L400 150 Z" fill="url(#wtr)" opacity=".92" />
        )}
        {isWater && (
          <ellipse cx={gx - 26} cy={greenY + 30} rx="70" ry="26" fill="url(#wtr)" opacity=".9" />
        )}

        {/* Fairway */}
        <path d={fairway} fill="url(#fw)" />

        {/* Bunkers — placed along the route; sand-hazard holes get an extra one. */}
        <ellipse cx="150" cy={midY + 22} rx={short ? 16 : 24} ry="11" fill="#e7d29a" />
        {isSand && <ellipse cx="262" cy={greenY - 18} rx="18" ry="9" fill="#e7d29a" />}
        <ellipse cx={gx - 30} cy={greenY + 16} rx="16" ry="8" fill="#e7d29a" />

        {/* Tee */}
        <circle cx="30" cy={teeY} r="7" fill="#1e5138" />

        {/* Green + pin */}
        <ellipse cx={gx} cy={greenY} rx={short ? 30 : 22} ry={short ? 18 : 14} fill="#2d6a4f" />
        <line x1={gx + 4} y1={greenY} x2={gx + 4} y2={greenY - 30} stroke="#13201a" strokeWidth="2.5" />
        <path d={`M${gx + 4} ${greenY - 30} L ${gx + 22} ${greenY - 24} L ${gx + 4} ${greenY - 18} Z`} fill="#d7402f" />

        {/* Aim line tee -> green */}
        <path
          d={`M34 ${teeY - 2} Q 200 ${midY - 6} ${gx} ${greenY}`}
          stroke="#13201a" strokeWidth="2" strokeDasharray="3 7" fill="none" opacity=".45"
        />
      </svg>

      <div className="wind-tag">
        <span style={{ display: "inline-block", transform: `rotate(${windDir}deg)` }}>↑</span>
        {wind} mph · {greens} greens
      </div>

      {signature && <div className="sig-tag">★ {signature}</div>}
    </div>
  );
}
