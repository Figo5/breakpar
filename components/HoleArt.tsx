import type { CourseHole } from "@/data/courses";

/**
 * Crafted, yardage-book-style hole diagram. Every shape is derived from the
 * hole's real data (par, dogleg, hazard, signature) — nothing is hand-drawn
 * per hole, so any course added to data/courses.ts renders automatically.
 *
 * Canvas is a 680x1040 PORTRAIT card: tee near the bottom, green near the top,
 * the hole running UP the surface. The tall aspect makes the card fill a phone
 * viewport (the concept's 680x560 was a desktop-frame mockup; the design
 * language — layered card, map dominant, UI on baked scrims — is preserved, the
 * exact ratio isn't sacred). Returns a bare <svg>; the caller (HoleMap -> the
 * play-screen card) owns sizing/positioning. Top and bottom scrims are baked
 * into the SVG so the header/chips (top) and controls/result panel (bottom,
 * absolute) that float over it stay legible without any CSS overlay scrim.
 *
 * The MAP is meant to dominate: the green/fairway occupy the upper ~60% of the
 * card, and the controls overlay only the bottom scrim band — not "a UI panel
 * with a map thumbnail," but "a map with some UI floating on it."
 */
export function HoleArt({ hole, ballT = 0.05 }: {
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
  // over water whose signature note calls it out as an island green. A normal
  // water hole (par 4/5, or a par 3 without the "island" note) is NOT this — it
  // gets a fairway on land with a pond guarding one side of the green.
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
        <ellipse cx={cx} cy={cy} rx={rx + 6} ry={ry + 6} fill="#9A8A5E" />
        <ellipse cx={cx - 3} cy={cy - 2.5} rx={rx} ry={ry} fill="#C9B98A" />
      </g>
    );
  }
  function treeCluster(cx: number, cy: number, key: string) {
    return (
      <g key={key} opacity={0.92}>
        <circle cx={cx} cy={cy} r={26} fill="#33552D" />
        <circle cx={cx + 20} cy={cy + 9} r={20} fill="#3C6338" />
        <circle cx={cx - 18} cy={cy + 13} r={17} fill="#3C6338" />
      </g>
    );
  }
  const defs = (
    <defs>
      <pattern id="mown" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
        <rect width="28" height="14" fill="#7bc06a" />
        <rect y="14" width="28" height="14" fill="#5e9950" />
      </pattern>
      <radialGradient id="pond" cx="32%" cy="28%" r="80%">
        <stop offset="0" stopColor="#5C97B8" />
        <stop offset="1" stopColor="#43789B" />
      </radialGradient>
      {/* Baked scrims: top for the hole-number/chips header, bottom (deep,
          ~40% of the card) for the controls/result panel that sits on it.
          Chips/buttons carry their own near-opaque backgrounds too, so
          legibility never depends on exact content height. */}
      <linearGradient id="scrimT" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#152418" stopOpacity=".62" />
        <stop offset="100%" stopColor="#152418" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="scrimB" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#152418" stopOpacity="0" />
        <stop offset="45%" stopColor="#152418" stopOpacity=".5" />
        <stop offset="100%" stopColor="#152418" stopOpacity=".9" />
      </linearGradient>
    </defs>
  );
  const scrims = (
    <>
      <rect x="0" y="0" width="680" height="250" fill="url(#scrimT)" />
      <rect x="0" y="600" width="680" height="440" fill="url(#scrimB)" />
    </>
  );

  // ======================================================================
  // ISLAND GREEN — no fairway; water fills the frame, tee on a small landmass
  // near the bottom, the green a ringed island reached by a pure carry up.
  // ======================================================================
  if (isIsland) {
    const teeX = 340, teeY = 858;
    const gx = 384, greenY = 388;
    const pinX = gx + 6, pinY = greenY;
    const greenRx = 86, greenRy = 56;

    // Straight, solid carry — no dashes, no bend. This is the "all carry,
    // no bailout" shot; softening it with a dashed curve undersells it.
    const shotP0 = { x: teeX, y: teeY - 26 };
    const shotP2 = { x: pinX, y: pinY };
    const ballX = shotP0.x + (shotP2.x - shotP0.x) * t;
    const ballY = shotP0.y + (shotP2.y - shotP0.y) * t;

    return (
      <svg viewBox="0 0 680 1040" aria-hidden="true">
        {defs}
        {/* Water fills the entire frame — the defining island trait */}
        <rect width="680" height="1040" fill="url(#pond)" />
        <path d="M60 120 Q 250 160 440 100" fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".4" />
        <path d="M80 280 Q 170 258 280 286" fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".45" />
        <path d="M300 660 Q 410 636 500 668" fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".4" />
        <path d="M70 520 Q 150 498 240 524" fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".4" />

        {treeCluster(56, 70, "t1")}
        {treeCluster(624, 70, "t2")}

        {/* Tee landmass, bottom-center */}
        <ellipse cx={teeX} cy={1010} rx="150" ry="96" fill="#8FAD7B" />
        <circle cx={teeX} cy={teeY} r="15" fill="#F7F4EA" stroke="#13201A" strokeWidth="4" />

        {/* The carry: solid amber shot-line, dead straight across the water */}
        <line x1={shotP0.x} y1={shotP0.y} x2={shotP2.x} y2={shotP2.y} stroke="#F2C14E" strokeWidth="5" opacity=".92" />

        {/* Island green: rough collar -> sand fringe -> apron -> mown surface */}
        <ellipse cx={gx} cy={greenY} rx={greenRx + 30} ry={greenRy + 30} fill="#7a9a68" />
        <ellipse cx={gx} cy={greenY} rx={greenRx + 20} ry={greenRy + 20} fill="#C9B98A" />
        <ellipse cx={gx} cy={greenY} rx={greenRx + 9} ry={greenRy + 9} fill="#8CC275" />
        <ellipse cx={gx} cy={greenY} rx={greenRx} ry={greenRy} fill="url(#mown)" stroke="rgba(19,32,26,.3)" strokeWidth="3" />
        {bunker(gx - greenRx - 8, greenY + greenRy - 10, 22, 12, "isb")}

        {/* Flagstick */}
        <line x1={pinX} y1={pinY} x2={pinX} y2={pinY - 86} stroke="#13201A" strokeWidth="5" />
        <path d={`M${pinX} ${pinY - 86} L ${pinX + 50} ${pinY - 70} L ${pinX} ${pinY - 56} Z`} fill="#C8493A" />

        {/* Ball marker along the carry at ballT */}
        <g>
          <circle cx={ballX} cy={ballY} r="16" fill="#F7F4EA" stroke="#13201A" strokeWidth="3.5" />
          <circle cx={ballX} cy={ballY} r="5" fill="#13201A" opacity=".35" />
        </g>

        {scrims}
      </svg>
    );
  }

  // ======================================================================
  // STANDARD HOLE — fairway ribbon on LAND, shaped by par (length + green
  // size) and dogleg (a real elbow turn). Runs bottom (tee) to top (green);
  // water hazards guard ONE side of the green, never surround it.
  // ======================================================================

  const teeX = 340, teeY = 902;

  // Tee -> green distance reads short/medium/long with par: par 3 stays
  // closer, par 5 climbs high up the card.
  const gy = short ? 476 : long ? 236 : 356;

  // Horizontal positions kept inside a band clear of the corner trees.
  const CENTER_X = 340, SAFE_LEFT = 158, SAFE_RIGHT = 522;
  function clampToBand(x: number, halfExtent: number) {
    const lo = SAFE_LEFT + halfExtent, hi = SAFE_RIGHT - halfExtent;
    return lo > hi ? CENTER_X : Math.min(hi, Math.max(lo, x));
  }

  // Green size scales with par: par 3 plays as a bigger, closer target;
  // par 5 sits smaller and further away.
  const greenRx = short ? 92 : long ? 50 : 68;
  const greenRy = short ? 56 : long ? 30 : 44;

  const greenSwing = short ? 60 : 118;
  const greenXRaw = dogleg === "L" ? CENTER_X - greenSwing : dogleg === "R" ? CENTER_X + greenSwing : CENTER_X;
  const gx = clampToBand(greenXRaw, greenRx - 8);

  // The dogleg elbow: a real waypoint the fairway turns through, not a soft
  // bow. Straight holes keep the elbow on the tee->green line (no turn).
  const elbowT = 0.52;
  const ex0 = teeX + (gx - teeX) * elbowT;
  const ey = teeY + (gy - teeY) * elbowT;
  const elbowHW = short ? 20 : long ? 36 : 30;
  const bend = short ? 70 : long ? 150 : 122;
  const exRaw = dogleg === "L" ? CENTER_X - bend : dogleg === "R" ? CENTER_X + bend : ex0;
  const ex = clampToBand(exRaw, elbowHW - 4);

  const pinX = gx + 6, pinY = gy;

  // Fairway half-widths taper along the route; par 3s stay tight, par 5s
  // stay generous longer (a real journey).
  const teeHW = short ? 24 : 46;
  const greenHW = short ? 22 : long ? 28 : 36;

  const outerLeg1 = quad(teeX, teeY, ex, ey, teeHW + 8, elbowHW + 8);
  const outerLeg2 = quad(ex, ey, gx, gy, elbowHW + 8, greenHW + 8);
  const innerLeg1 = quad(teeX, teeY, ex, ey, Math.max(5, teeHW - 12), Math.max(5, elbowHW - 10));
  const innerLeg2 = quad(ex, ey, gx, gy, Math.max(5, elbowHW - 10), Math.max(5, greenHW - 12));

  // Shot-line follows the same elbow route as the fairway.
  const shotP0 = { x: teeX, y: teeY - 8 };
  const shotP1 = { x: ex, y: ey };
  const shotP2 = { x: pinX, y: pinY };
  function bez(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, u: number) {
    const um = 1 - u;
    return { x: um * um * p0.x + 2 * um * u * p1.x + u * u * p2.x, y: um * um * p0.y + 2 * um * u * p1.y + u * u * p2.y };
  }
  function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  const ballPt = t < 0.5 ? bez(shotP0, midpoint(shotP0, shotP1), shotP1, t * 2) : bez(shotP1, midpoint(shotP1, shotP2), shotP2, (t - 0.5) * 2);

  // Bunkers: one at the corner of the dogleg (the strategic line), a
  // greenside bunker, and (par 5) a second fairway bunker down the second
  // leg. Sand-hazard holes get a third, prominent one near the green.
  const cornerSign = dogleg === "L" ? -1 : 1;
  const fb1x = ex + cornerSign * (elbowHW + 44), fb1y = ey;
  const fb2x = gx + (dogleg === "R" ? -1 : 1) * (greenHW + 52), fb2y = ey + (gy - ey) * 0.6;
  // Greenside bunker on the opposite side from any water guard, so both read.
  const gbx = gx + greenRx + 12, gby = gy + greenRy - 6;

  // Water pond: guards the FRONT-LEFT of the green (a distinct blob beside it,
  // not an ellipse the green sits inside), so a water par-4/5 reads as
  // "green guarded by water" — clearly on land with a fairway — never as a
  // fairway-less island.
  const pondCx = gx - greenRx - 30, pondCy = gy + greenRy + 18;

  return (
    <svg viewBox="0 0 680 1040" aria-hidden="true">
      {defs}

      {/* Base turf */}
      <rect width="680" height="1040" fill="#8FAD7B" />

      {/* Ocean band along the bottom edge */}
      {isOcean && (
        <>
          <path d="M0 1040 L0 906 C 190 950, 500 872, 680 912 L680 1040 Z" fill="url(#pond)" />
          <path d="M0 906 C 190 950, 500 872, 680 912" fill="none" stroke="#2F5A76" strokeWidth="3" opacity=".85" />
          <path d="M70 970 Q 150 952 230 970" fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".5" />
          <path d="M420 962 Q 500 944 580 960" fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".5" />
        </>
      )}

      {/* Tree framing — drawn first so the hole itself reads on top */}
      {treeCluster(52, 70, "t1")}
      {treeCluster(628, 70, "t2")}
      {!isOcean && treeCluster(52, 956, "t3")}
      {!isOcean && treeCluster(630, 962, "t4")}

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
          <path d={quad(teeX, teeY, gx, gy + 70, teeHW + 8, greenHW + 6)} fill="#3f7d52" />
          <path d={quad(teeX, teeY, gx, gy + 70, Math.max(5, teeHW - 12), Math.max(5, greenHW - 10))} fill="#74b788" />
        </>
      )}

      {/* Water guarding the FRONT-LEFT of the green (drawn under the green so
          the green sits clearly on its own turf apron) */}
      {isWater && (
        <>
          <ellipse cx={pondCx} cy={pondCy} rx={short ? 96 : 112} ry={44} fill="url(#pond)" stroke="#2F5A76" strokeWidth="3" />
          <path d={`M${pondCx - (short ? 78 : 92)} ${pondCy} Q ${pondCx} ${pondCy - 16} ${pondCx + (short ? 78 : 92)} ${pondCy}`} fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".5" />
          <path d={`M${pondCx - (short ? 58 : 70)} ${pondCy + 16} Q ${pondCx} ${pondCy + 4} ${pondCx + (short ? 58 : 70)} ${pondCy + 16}`} fill="none" stroke="#79A8C4" strokeWidth="2" opacity=".4" />
        </>
      )}

      {/* Bunkers (before the green so the green apron overlaps them cleanly) */}
      {!short && bunker(fb1x, fb1y, long ? 30 : 26, 16, "fb1")}
      {!short && long && bunker(fb2x, fb2y, 26, 14, "fb2")}
      {isSand && bunker(gx - 14, gy - greenRy - 22, 22, 12, "sb")}
      {bunker(gbx, gby, 26, 14, "gb")}

      {/* Green: apron + mown-stripe surface */}
      <ellipse cx={gx} cy={gy} rx={greenRx + 10} ry={greenRy + 10} fill="#8CC275" />
      <ellipse cx={gx} cy={gy} rx={greenRx} ry={greenRy} fill="url(#mown)" stroke="rgba(19,32,26,.28)" strokeWidth="3" />

      {/* Tee marker */}
      <circle cx={teeX} cy={teeY} r="15" fill="#F7F4EA" stroke="#13201A" strokeWidth="4" />

      {/* Shot-line, tee -> pin, through the dogleg elbow */}
      <path
        d={`M${shotP0.x} ${shotP0.y} Q ${midpoint(shotP0, shotP1).x} ${midpoint(shotP0, shotP1).y} ${shotP1.x} ${shotP1.y} Q ${midpoint(shotP1, shotP2).x} ${midpoint(shotP1, shotP2).y} ${shotP2.x} ${shotP2.y}`}
        stroke="#F2C14E" strokeWidth="4.5" strokeDasharray="6 12" fill="none" opacity=".85"
      />

      {/* Flagstick */}
      <line x1={pinX} y1={pinY} x2={pinX} y2={pinY - 86} stroke="#13201A" strokeWidth="5" />
      <path d={`M${pinX} ${pinY - 86} L ${pinX + 50} ${pinY - 70} L ${pinX} ${pinY - 56} Z`} fill="#C8493A" />

      {/* Ball marker along the shot-line at ballT */}
      <g>
        <circle cx={ballPt.x} cy={ballPt.y} r="16" fill="#F7F4EA" stroke="#13201A" strokeWidth="3.5" />
        <circle cx={ballPt.x} cy={ballPt.y} r="5" fill="#13201A" opacity=".35" />
      </g>

      {scrims}
    </svg>
  );
}
