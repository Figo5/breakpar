import type { CourseHole } from "@/data/courses";

/**
 * Crafted, yardage-book-style hole diagram. Every shape is derived from the
 * hole's real data (par, dogleg, hazard, signature) — nothing is hand-drawn
 * per hole, so any course added to data/courses.ts renders automatically.
 *
 * Canvas is 400x190 to match the play screen's banner (`.play-map`, ~190px
 * tall). Trees are drawn first so the green/fairway always read on top of
 * them at the corners.
 */
export function HoleArt({ hole, wind, windDir, greens, ballT = 0.05 }: {
  hole: CourseHole; wind: number; windDir: number; greens: string;
  ballT?: number; // ball position along the hole, 0 (tee) -> 1 (green). Display-only.
}) {
  const { par, dogleg, hazard, signature } = hole;
  const long = par === 5;
  const short = par === 3;

  const isOcean = hazard === "ocean";
  const isWater = hazard === "water";
  const isSand = hazard === "sand";
  // An island hole has no fairway at all — a full carry over water to a green
  // surrounded on every side. The signal already exists in the data: a par 3
  // over water whose signature note calls it out as an island green.
  const isIsland = short && isWater && !!signature && /island/i.test(signature);

  const t = Math.max(0, Math.min(1, ballT));

  function perp(ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }
  function quad(ax: number, ay: number, bx: number, by: number, ha: number, hb: number) {
    const n = perp(ax, ay, bx, by);
    return `M${ax + n.x * ha} ${ay + n.y * ha} L${bx + n.x * hb} ${by + n.y * hb} L${bx - n.x * hb} ${by - n.y * hb} L${ax - n.x * ha} ${ay - n.y * ha} Z`;
  }
  function bunker(cx: number, cy: number, rx: number, ry: number, key: string) {
    return (
      <g key={key}>
        <ellipse cx={cx} cy={cy} rx={rx + 3} ry={ry + 3} fill="#9A8A5E" />
        <ellipse cx={cx - 1.5} cy={cy - 1} rx={rx} ry={ry} fill="#C9B98A" />
      </g>
    );
  }
  function treeCluster(cx: number, cy: number, key: string) {
    return (
      <g key={key} opacity={0.92}>
        <circle cx={cx} cy={cy} r={11} fill="#33552D" />
        <circle cx={cx + 9} cy={cy + 4} r={9} fill="#3C6338" />
        <circle cx={cx - 8} cy={cy + 6} r={8} fill="#3C6338" />
      </g>
    );
  }
  const defs = (
    <defs>
      <pattern id="mown" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
        <rect width="20" height="10" fill="#7bc06a" />
        <rect y="10" width="20" height="10" fill="#5e9950" />
      </pattern>
      <radialGradient id="pond" cx="30%" cy="26%" r="80%">
        <stop offset="0" stopColor="#5C97B8" />
        <stop offset="1" stopColor="#43789B" />
      </radialGradient>
    </defs>
  );

  // ======================================================================
  // ISLAND GREEN — no fairway; water fills the frame, tee sits on a small
  // patch of land, the green is a ringed island reached by a pure carry.
  // ======================================================================
  if (isIsland) {
    const teeX = 42, teeY = 122;
    const gx = 296, greenY = 90;
    const pinX = gx + 3, pinY = greenY;
    const greenRx = 30, greenRy = 18;

    // Straight, solid carry — no dashes, no bend. This is the "all carry,
    // no bailout" shot; softening it with a dashed curve undersells it.
    const shotP0 = { x: teeX + 6, y: teeY - 12 };
    const shotP2 = { x: pinX, y: pinY };
    const ballX = shotP0.x + (shotP2.x - shotP0.x) * t;
    const ballY = shotP0.y + (shotP2.y - shotP0.y) * t;

    return (
      <div className="hole-art">
        <svg viewBox="0 0 400 190" preserveAspectRatio="none" aria-hidden="true">
          {defs}
          {/* Water fills almost the entire frame */}
          <rect width="400" height="190" fill="url(#pond)" />
          <path d="M0 10 Q 140 30 260 6" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".4" />
          <path d="M40 60 Q 90 50 150 62" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".45" />
          <path d="M160 150 Q 220 140 270 155" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".4" />
          <path d="M20 110 Q 60 100 100 112" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".4" />

          {treeCluster(378, 20, "t1")}
          {treeCluster(378, 168, "t2")}

          {/* Tee landmass, corner of the frame */}
          <ellipse cx="6" cy="160" rx="58" ry="46" fill="#8FAD7B" />
          <circle cx={teeX} cy={teeY} r="7" fill="#F7F4EA" stroke="#13201A" strokeWidth="2" />

          {/* The carry: solid amber shot-line, dead straight across the water */}
          <line
            x1={shotP0.x} y1={shotP0.y} x2={shotP2.x} y2={shotP2.y}
            stroke="#F2C14E" strokeWidth="2.5" opacity=".92"
          />

          {/* Island green: rough collar -> sand fringe -> contour shadow -> apron -> mown surface */}
          <ellipse cx={gx} cy={greenY} rx={greenRx + 12} ry={greenRy + 12} fill="#7a9a68" />
          <ellipse cx={gx} cy={greenY} rx={greenRx + 8} ry={greenRy + 8} fill="#C9B98A" />
          <ellipse cx={gx} cy={greenY} rx={greenRx + 4} ry={greenRy + 4} fill="#8CC275" />
          <ellipse cx={gx} cy={greenY} rx={greenRx} ry={greenRy} fill="url(#mown)" stroke="rgba(19,32,26,.3)" strokeWidth="1.5" />
          {bunker(gx - greenRx - 2, greenY + greenRy - 4, 9, 5, "isb")}

          {/* Flagstick */}
          <line x1={pinX} y1={pinY} x2={pinX} y2={pinY - 34} stroke="#13201A" strokeWidth="2.5" />
          <path d={`M${pinX} ${pinY - 34} L ${pinX + 20} ${pinY - 28} L ${pinX} ${pinY - 22} Z`} fill="#C8493A" />

          {/* Ball marker along the carry at ballT */}
          <g>
            <circle cx={ballX} cy={ballY} r="7" fill="#F7F4EA" stroke="#13201A" strokeWidth="1.4" />
            <circle cx={ballX} cy={ballY} r="2" fill="#13201A" opacity=".35" />
          </g>
        </svg>

        <div className="wind-tag">
          <span style={{ display: "inline-block", transform: `rotate(${windDir}deg)` }}>↑</span>
          {wind} mph · {greens} greens
        </div>
        {signature && <div className="sig-tag">★ {signature}</div>}
      </div>
    );
  }

  // ======================================================================
  // STANDARD HOLE — fairway ribbon, shaped by par (length + green size) and
  // dogleg (a real elbow turn, not a gentle bow).
  // ======================================================================

  // Tee -> green distance reads short/medium/long with par.
  const teeX = short ? 148 : long ? 18 : 26;
  const teeY = 114;
  const gx = short ? 296 : long ? 374 : 350;

  // Vertical positions are kept inside a narrow safe band: the play screen
  // floats a header over the top ~63px and condition chips over the bottom
  // ~53px of this 190-tall canvas (measured live against the real overlay),
  // so anything outside it collides with that text instead of the art.
  const CENTER_Y = 98, SAFE_TOP = 66, SAFE_BOTTOM = 132;
  function clampToBand(y: number, halfExtent: number) {
    const lo = SAFE_TOP + halfExtent, hi = SAFE_BOTTOM - halfExtent;
    return lo > hi ? CENTER_Y : Math.min(hi, Math.max(lo, y));
  }

  // Green size scales with par: par 3 plays as a bigger, closer target;
  // par 5 sits smaller and further away.
  const greenRx = short ? 34 : long ? 18 : 25;
  const greenRy = short ? 20 : long ? 11 : 15;

  const greenSwing = short ? 14 : 26;
  const greenYRaw = dogleg === "L" ? CENTER_Y - greenSwing : dogleg === "R" ? CENTER_Y + greenSwing : CENTER_Y;
  const greenY = clampToBand(greenYRaw, greenRy - 3);

  // The dogleg elbow: a real waypoint the fairway turns through, not just a
  // soft control-point bow. For a straight hole the elbow sits exactly on
  // the tee->green line, so no turn is visible. The elbow (a thin ribbon)
  // can swing further than the green (a much bigger shape) and still clamp
  // safely into the band.
  const elbowT = 0.55;
  const ex = teeX + (gx - teeX) * elbowT;
  const elbowHW = short ? 8 : long ? 15 : 13;
  const bend = short ? 18 : long ? 38 : 30;
  const eyRaw = dogleg === "L" ? CENTER_Y - bend : dogleg === "R" ? CENTER_Y + bend : CENTER_Y;
  const ey = clampToBand(eyRaw, elbowHW - 2);

  const pinX = gx + 3, pinY = greenY;

  // Fairway half-widths taper along the route; par 3s stay tight (minimal
  // fairway, it's a tee shot), par 5s stay generous longer (a real journey).
  const teeHW = short ? 10 : 19;
  const greenHW = short ? 9 : long ? 11 : 14;

  const outerLeg1 = quad(teeX, teeY, ex, ey, teeHW + 3, elbowHW + 3);
  const outerLeg2 = quad(ex, ey, gx, greenY, elbowHW + 3, greenHW + 3);
  const innerLeg1 = quad(teeX, teeY, ex, ey, Math.max(2, teeHW - 5), Math.max(2, elbowHW - 4));
  const innerLeg2 = quad(ex, ey, gx, greenY, Math.max(2, elbowHW - 4), Math.max(2, greenHW - 5));

  // Shot-line follows the same elbow route as the fairway.
  const shotP0 = { x: teeX + 4, y: teeY - 2 };
  const shotP1 = { x: ex, y: ey };
  const shotP2 = { x: pinX, y: pinY };
  const mt = 1 - t;
  // Two-segment quadratic (tee->elbow->green): pick the half the ball is in.
  function bez(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, u: number) {
    const um = 1 - u;
    return { x: um * um * p0.x + 2 * um * u * p1.x + u * u * p2.x, y: um * um * p0.y + 2 * um * u * p1.y + u * u * p2.y };
  }
  const ballPt = t < 0.5 ? bez(shotP0, midpoint(shotP0, shotP1), shotP1, t * 2) : bez(shotP1, midpoint(shotP1, shotP2), shotP2, (t - 0.5) * 2);
  function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // Bunkers: one at the corner of the dogleg (the strategic line), a
  // greenside bunker, and (par 5) a second fairway bunker further down the
  // second leg. Sand-hazard holes get a third, prominent one near the green.
  const cornerSign = dogleg === "L" ? 1 : -1;
  const fb1x = ex, fb1y = ey + cornerSign * (elbowHW + 16);
  const fb2x = ex + (gx - ex) * 0.65, fb2y = greenY + (dogleg === "R" ? -1 : 1) * (greenHW + 20);
  const gbx = gx - 32, gby = greenY + (short ? 14 : 17);

  return (
    <div className="hole-art">
      <svg viewBox="0 0 400 190" preserveAspectRatio="none" aria-hidden="true">
        {defs}

        {/* Base turf */}
        <rect width="400" height="190" fill="#8FAD7B" />

        {/* Ocean band along the bottom edge */}
        {isOcean && (
          <>
            <path d="M0 190 L0 163 C 110 178, 300 148, 400 166 L400 190 Z" fill="url(#pond)" />
            <path d="M0 163 C 110 178, 300 148, 400 166" fill="none" stroke="#2F5A76" strokeWidth="1.5" opacity=".85" />
            <path d="M40 178 Q 80 172 120 178" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".5" />
            <path d="M240 175 Q 280 168 320 176" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".5" />
            <path d="M340 172 Q 365 166 390 173" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".45" />
          </>
        )}

        {/* Tree framing — drawn first so the hole itself reads on top */}
        {treeCluster(20, 22, "t1")}
        {treeCluster(380, 22, "t2")}
        {!isOcean && treeCluster(20, 168, "t3")}
        {!isOcean && treeCluster(384, 170, "t4")}

        {/* Fairway ribbon — two-tone, bent through the dogleg elbow */}
        {!short && (
          <>
            <path d={`${outerLeg1} ${outerLeg2}`} fill="#3f7d52" />
            <path d={`${innerLeg1} ${innerLeg2}`} fill="#74b788" />
          </>
        )}
        {short && (
          // Minimal fairway for a one-shot par 3 — a short cut strip, not a route.
          <>
            <path d={quad(teeX, teeY, gx - 30, greenY, teeHW + 3, greenHW + 2)} fill="#3f7d52" />
            <path d={quad(teeX, teeY, gx - 30, greenY, Math.max(2, teeHW - 5), Math.max(2, greenHW - 4))} fill="#74b788" />
          </>
        )}

        {/* Bunkers */}
        {!short && bunker(fb1x, fb1y, long ? 15 : 13, 8, "fb1")}
        {!short && long && bunker(fb2x, fb2y, 13, 7, "fb2")}
        {isSand && bunker(gx - 10, greenY - 21, 11, 6, "sb")}
        {bunker(gbx, gby, 13, 7, "gb")}

        {/* Water guarding the green */}
        {isWater && (
          <>
            <ellipse cx={gx - 28} cy={greenY + (short ? 28 : 33)} rx="70" ry="23" fill="url(#pond)" stroke="#2F5A76" strokeWidth="1.6" />
            <path d={`M${gx - 78} ${greenY + (short ? 28 : 33)} Q ${gx - 28} ${greenY + (short ? 20 : 25)} ${gx + 22} ${greenY + (short ? 28 : 33)}`} fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".55" />
            <path d={`M${gx - 60} ${greenY + (short ? 38 : 43)} Q ${gx - 20} ${greenY + (short ? 32 : 37)} ${gx + 10} ${greenY + (short ? 38 : 43)}`} fill="none" stroke="#79A8C4" strokeWidth="1.1" opacity=".4" />
          </>
        )}

        {/* Green: apron + mown-stripe surface */}
        <ellipse cx={gx} cy={greenY} rx={greenRx + 4} ry={greenRy + 4} fill="#8CC275" />
        <ellipse cx={gx} cy={greenY} rx={greenRx} ry={greenRy} fill="url(#mown)" stroke="rgba(19,32,26,.28)" strokeWidth="1.5" />

        {/* Tee marker */}
        <circle cx={teeX} cy={teeY} r="7" fill="#F7F4EA" stroke="#13201A" strokeWidth="2" />

        {/* Shot-line, tee -> pin, through the dogleg elbow */}
        <path
          d={`M${shotP0.x} ${shotP0.y} Q ${midpoint(shotP0, shotP1).x} ${midpoint(shotP0, shotP1).y} ${shotP1.x} ${shotP1.y} Q ${midpoint(shotP1, shotP2).x} ${midpoint(shotP1, shotP2).y} ${shotP2.x} ${shotP2.y}`}
          stroke="#F2C14E" strokeWidth="2" strokeDasharray="3 6" fill="none" opacity=".85"
        />

        {/* Flagstick */}
        <line x1={pinX} y1={pinY} x2={pinX} y2={pinY - 34} stroke="#13201A" strokeWidth="2.5" />
        <path d={`M${pinX} ${pinY - 34} L ${pinX + 20} ${pinY - 28} L ${pinX} ${pinY - 22} Z`} fill="#C8493A" />

        {/* Ball marker along the shot-line at ballT */}
        <g>
          <circle cx={ballPt.x} cy={ballPt.y} r="7" fill="#F7F4EA" stroke="#13201A" strokeWidth="1.4" />
          <circle cx={ballPt.x} cy={ballPt.y} r="2" fill="#13201A" opacity=".35" />
        </g>
      </svg>

      <div className="wind-tag">
        <span style={{ display: "inline-block", transform: `rotate(${windDir}deg)` }}>↑</span>
        {wind} mph · {greens} greens
      </div>

      {signature && <div className="sig-tag">★ {signature}</div>}
    </div>
  );
}
