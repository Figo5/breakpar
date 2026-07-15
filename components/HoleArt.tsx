import type { CourseHole } from "@/data/courses";
import { decodeBallDisplay } from "@/lib/ballDisplay";
import { pickDryBallPosition } from "@/lib/holeMapPosition";

/**
 * Crafted, yardage-book-style hole diagram. Every shape is derived from the
 * hole's real data (par, dogleg, hazard, signature) — nothing is hand-drawn
 * per hole, so any course added to data/courses.ts renders automatically.
 *
 * Canvas presents directly in the original concept's flat 680x560 plane.
 * Nothing is vertically compressed: circles stay circular and the artwork
 * reads as a printed yardage-book diagram rather than a foreshortened scene.
 * Returns a bare <svg>; the caller (HoleMap -> the
 * play-screen card) owns sizing/positioning. Top and bottom scrims are baked
 * into the SVG so the header/chips (top) and controls/result panel (bottom,
 * absolute) that float over it stay legible without any CSS overlay scrim.
 *
 * DETERMINISTIC VARIETY (SPEC-4): the category shape comes from par/dogleg/
 * hazard, but the specifics — bunker count/placement, tree framing, fairway
 * bend/width, water body shape, green proportions — are jittered by a seeded
 * PRNG so two holes in the same category don't render identically. The seed is
 * a hash of stable per-hole data (par:yardage:strokeIndex:number:dogleg:hazard),
 * so a hole ALWAYS looks the same for every player and every view (no
 * Math.random), yet differs from its category-mates. Critically, NO seeded draw
 * depends on ballT — the terrain must not shift as the shot-progress dot moves.
 */

// --- Deterministic PRNG (no dependency) -----------------------------------
// FNV-1a string hash -> 32-bit seed; mulberry32 -> uniform [0,1). Same seed in,
// same sequence out, forever.
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function HoleArt({ hole, ballT = 0.05 }: {
  hole: CourseHole; wind: number; windDir: number; greens: string;
  ballT?: number; // ball position along the hole, 0 (tee) -> 1 (green). Display-only.
}) {
  const { par, number, yardage, strokeIndex, dogleg, hazard, signature } = hole;
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

  const { progress: t, state: ballState } = decodeBallDisplay(ballT);

  // Seeded PRNG + convenience draws. Seed is stable per hole (never involves
  // ballT), so the terrain is identical on every render of this hole.
  const rng = mulberry32(hashSeed(`${par}:${yardage}:${strokeIndex}:${number}:${dogleg}:${hazard}`));
  const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  // Difficulty in [0,1]: strokeIndex 1 (hardest) -> ~1, 18 (easiest) -> ~0.
  const difficulty = (18 - (strokeIndex - 1)) / 18;

  function perp(ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }
  function bunkerShape(cx: number, cy: number, rx: number, ry: number, key: string) {
    return (
      <g key={key}>
        <ellipse cx={cx} cy={cy} rx={rx + 4} ry={ry + 4} fill="#9A8A5E" />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#E6D9B5" />
      </g>
    );
  }
  function treeCluster(cx: number, cy: number, scale: number, key: string) {
    return (
      <g key={key} opacity={0.92}>
        <circle cx={cx} cy={cy} r={26 * scale} fill="#33552D" />
        <circle cx={cx + 20 * scale} cy={cy + 9 * scale} r={20 * scale} fill="#3C6338" />
        <circle cx={cx - 18 * scale} cy={cy + 13 * scale} r={17 * scale} fill="#3C6338" />
      </g>
    );
  }

  // Seeded tree framing along the LEFT/RIGHT edges (never the central playable
  // band), varied in count/position/size so no two holes frame identically.
  // Ocean holes keep the bottom clear (water band lives there).
  function seededTrees(minY: number, maxY: number, count: number) {
    const out: { x: number; y: number; s: number }[] = [];
    for (let i = 0; i < count; i++) {
      const leftSide = rng() < 0.5;
      out.push({
        x: leftSide ? rand(26, 94) : rand(586, 654),
        y: rand(minY, maxY),
        s: rand(0.7, 1.28),
      });
    }
    return out;
  }

  const defs = (
    <defs>
      <pattern id="mown" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
        <rect width="6" height="12" fill="#6FA85C" />
        <rect x="6" width="6" height="12" fill="#68A055" />
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
      <rect x="0" y="0" width="680" height="100" fill="url(#scrimT)" />
      <rect x="0" y="330" width="680" height="230" fill="url(#scrimB)" />
    </>
  );

  // ======================================================================
  // ISLAND GREEN — no fairway; water fills the frame, tee on a small landmass
  // near the bottom, the green a ringed island reached by a pure carry up.
  // (Category shape is fixed — an island is an island — but green proportions,
  // ripples, and tree framing are still seeded so two islands differ.)
  // ======================================================================
  if (isIsland) {
    // Sawgrass-17 concept geometry: turf frames one large organic pond, with a
    // narrow access tongue, an irregular island, and a pure carry from the tee.
    const shotP0 = { x: 326, y: 470 };
    const shotP2 = { x: 392, y: 206 };
    const lineBallX = shotP0.x + (shotP2.x - shotP0.x) * t;
    const lineBallY = shotP0.y + (shotP2.y - shotP0.y) * t;
    const ballX = ballState === "short" ? 332 : lineBallX;
    const ballY = ballState === "short" ? 292 : lineBallY;

    return (
      <svg viewBox="0 0 680 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {defs}
        <rect width="680" height="560" fill="#8FAD7B" />

        {/* The reference's sparse edge framing. */}
        <circle cx="48" cy="86" r="24" fill="#3C6338" /><circle cx="94" cy="46" r="18" fill="#33552D" />
        <circle cx="14" cy="150" r="20" fill="#33552D" /><circle cx="636" cy="66" r="21" fill="#3C6338" />
        <circle cx="592" cy="36" r="16" fill="#33552D" /><circle cx="664" cy="132" r="18" fill="#33552D" />
        <circle cx="648" cy="474" r="19" fill="#3C6338" /><circle cx="606" cy="512" r="15" fill="#33552D" />
        <circle cx="34" cy="456" r="17" fill="#33552D" /><circle cx="72" cy="504" r="14" fill="#3C6338" />

        {/* One large pond, surrounded by turf — water dominates without making
            the entire card a blue rectangle. */}
        <path d="M94 300 C86 206 146 120 250 82 C354 44 490 54 564 118 C630 174 638 270 596 350 C550 438 448 484 338 476 C228 468 104 412 94 300 Z"
          fill="url(#pond)" stroke="#2F5A76" strokeWidth="2.5" />
        <path d="M168 186 C212 164 262 154 306 160" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".55" />
        <path d="M476 374 C518 358 550 330 570 298" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".55" />
        <path d="M146 332 C174 352 210 364 248 368" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".45" />
        <path d="M420 108 C466 116 508 136 536 166" fill="none" stroke="#79A8C4" strokeWidth="1.3" opacity=".45" />

        {/* Access tongue stops at the island; it is not a playable fairway. */}
        <path d="M118 264 C158 248 206 242 250 248 C264 250 272 238 284 232" fill="none" stroke="#C9B98A" strokeWidth="11" strokeLinecap="round" />
        <path d="M120 262 C158 246 204 241 248 246" fill="none" stroke="#9A8A5E" strokeWidth="1.1" strokeDasharray="5 7" opacity=".75" />

        {/* Organic island collar, sand ring, mown green, and bunker. */}
        <path d="M290 150 C330 118 400 112 448 136 C494 158 506 210 484 252 C460 298 394 314 342 294 C290 274 268 216 282 180 C284 170 287 159 290 150 Z" fill="#6B5233" />
        <path d="M297 155 C334 126 398 120 441 141 C484 162 495 208 476 245 C455 286 395 302 347 285 C300 268 280 216 291 183 C293 173 295 164 297 155 Z" fill="#C9B98A" />
        <path d="M304 162 C338 136 396 130 434 148 C472 166 482 208 465 241 C446 277 393 291 351 277 C309 263 291 216 300 188 Z" fill="url(#mown)" />
        <path d="M312 174 C342 150 392 145 424 161 C456 177 463 212 449 239 C433 268 390 279 356 268 C322 257 307 218 313 194 Z" fill="none" stroke="#4E7C3F" strokeWidth="4" opacity=".38" />
        <path d="M320 180 C348 160 390 155 419 169 C446 183 452 212 441 235 C427 260 389 269 358 259 C327 249 313 216 320 195 Z" fill="#8CC275" />
        <path d="M360 270 C346 256 352 237 371 232 C392 226 409 237 410 253 C411 270 392 282 374 279 C367 278 363 274 360 270 Z" fill="#8E7645" />
        <path d="M363 266 C351 253 357 240 373 236 C391 231 405 240 406 252 C407 266 391 276 375 273 C369 272 366 269 363 266 Z" fill="#EDE3C4" />

        <line x1="392" y1="206" x2="392" y2="138" stroke="#152418" strokeWidth="2.5" />
        <path d="M392 138 L425 148 L392 158 Z" fill="#C8493A" />

        {/* Tee platform and uninterrupted carry line. */}
        <path d="M256 488 C300 470 358 466 406 478" fill="none" stroke="#C9B98A" strokeWidth="17" strokeLinecap="round" />
        <rect x="306" y="466" width="40" height="21" rx="3" fill="#4E7C3F" />
        <line x1={shotP0.x} y1={shotP0.y} x2={shotP2.x} y2={shotP2.y} stroke="#F2C14E" strokeWidth="2.5" opacity=".95" />
        <text x="350" y="350" fill="#FFFFFF" stroke="#2F5A76" strokeWidth="4.5" paintOrder="stroke" fontSize="15" fontWeight="600" textAnchor="middle">{yardage}</text>
        <circle cx={ballX} cy={ballY} r="4.6" fill="#F7F4EA" stroke="#13201A" strokeWidth="1.4" />

        <rect x="0" y="0" width="680" height="100" fill="url(#scrimT)" />
        <rect x="0" y="330" width="680" height="230" fill="url(#scrimB)" />
      </svg>
    );
  }

  // ======================================================================
  // STANDARD HOLE — fairway ribbon on LAND, shaped by par (length + green
  // size) and dogleg (a real elbow turn). Runs bottom (tee) to top (green);
  // water hazards guard ONE side of the green, never surround it. Bunkers,
  // trees, bend, width, water shape and green proportions are all seeded.
  // ======================================================================

  const teeX = 340, teeY = 510;

  // Tee -> green distance reads short/medium/long with par: par 3 stays
  // closer, par 5 climbs high up the card. (Par-length scaling: NOT jittered.)
  const gy = short ? 354 : long ? 142 : 232;

  // Horizontal positions kept inside a band clear of the corner trees.
  const CENTER_X = 340, SAFE_LEFT = 158, SAFE_RIGHT = 522;
  function clampToBand(x: number, halfExtent: number) {
    const lo = SAFE_LEFT + halfExtent, hi = SAFE_RIGHT - halfExtent;
    return lo > hi ? CENTER_X : Math.min(hi, Math.max(lo, x));
  }

  // Green size scales with par (fixed), then a small seeded jitter on each
  // axis so greens aren't all identical ellipses (rounder vs elongated).
  const baseGreenRx = short ? 100 : long ? 56 : 76;
  const baseGreenRy = short ? 62 : long ? 34 : 49;
  const greenRx = baseGreenRx * rand(0.9, 1.12);
  const greenRy = baseGreenRy * rand(0.88, 1.12);

  const greenSwing = short ? 60 : 118;
  const greenXRaw = dogleg === "L" ? CENTER_X - greenSwing : dogleg === "R" ? CENTER_X + greenSwing : CENTER_X;
  const gx = clampToBand(greenXRaw, greenRx - 8);

  // The dogleg elbow: a real waypoint the fairway turns through. Direction is
  // FIXED by dogleg; only the sharpness (bend magnitude) and the elbow's
  // position along the route are seeded, so same-direction doglegs differ.
  const elbowT = rand(0.46, 0.58);
  const ex0 = teeX + (gx - teeX) * elbowT;
  const baseElbowHW = short ? 20 : long ? 36 : 30;
  const bend = (short ? 70 : long ? 150 : 122) * rand(0.82, 1.18);
  const exRaw = dogleg === "L" ? CENTER_X - bend : dogleg === "R" ? CENTER_X + bend : ex0;

  // Fairway width: harder holes (low strokeIndex) seed NARROWER — a subtle but
  // real visual difficulty signal — plus a small per-hole jitter on top.
  const widthFactor = lerp(1.28, 0.92, difficulty) * rand(0.94, 1.08);
  const teeHW = (short ? 24 : 46) * widthFactor;
  const elbowHW = baseElbowHW * widthFactor;
  const greenHW = (short ? 22 : long ? 28 : 36) * widthFactor;

  const ex = clampToBand(exRaw, elbowHW - 4);
  const ey = teeY + (gy - teeY) * elbowT;

  const pinX = gx + 6, pinY = gy;

  // A printed-map corridor, not a runway: constant-width rounded strokes keep
  // the route in one flat plan view. Distance comes from its length, not from
  // artificial perspective tapering toward the green.
  const flatFairwayWidth = short ? 42 : long ? 76 : 68;
  const fairwayPath = short
    ? `M${teeX} ${teeY} L${gx} ${gy + 54}`
    : `M${teeX} ${teeY} L${ex} ${ey} L${gx} ${gy}`;

  // Route helpers (for seeded bunker / cross-water placement along the hole).
  function routePoint(u: number) {
    if (u <= 0.5) { const s = u / 0.5; return { x: teeX + (ex - teeX) * s, y: teeY + (ey - teeY) * s }; }
    const s = (u - 0.5) / 0.5; return { x: ex + (gx - ex) * s, y: ey + (gy - ey) * s };
  }
  function routePerp(u: number) {
    const a = u <= 0.5 ? { x: teeX, y: teeY } : { x: ex, y: ey };
    const b = u <= 0.5 ? { x: ex, y: ey } : { x: gx, y: gy };
    return perp(a.x, a.y, b.x, b.y);
  }
  function fairwayHalfWidthAt(u: number) {
    if (u <= 0.5) { const s = u / 0.5; return lerp(teeHW, elbowHW, s); }
    const s = (u - 0.5) / 0.5; return lerp(elbowHW, greenHW, s);
  }

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
  function linePointAt(u: number) {
    return u < 0.5
      ? bez(shotP0, midpoint(shotP0, shotP1), shotP1, u * 2)
      : bez(shotP1, midpoint(shotP1, shotP2), shotP2, (u - 0.5) * 2);
  }
  const lieSide = (hashSeed(`${par}:${yardage}:${number}:ball-side`) & 1) === 0 ? -1 : 1;

  // ---- Water body: seeded placement + size (front / left / right / cross),
  // always guarding — never surrounding — the green, so a water hole never
  // reads as an island. "cross" is a carry hazard across the fairway. ----
  type Water = { cx: number; cy: number; rx: number; ry: number };
  let water: Water | null = null;
  if (isWater) {
    // Short holes have minimal fairway, so keep water at the green (no cross).
    const mode = pick(short ? ["front", "left", "right"] : ["front", "left", "right", "cross"]);
    if (mode === "cross") {
      const u = rand(0.5, 0.72);
      const p = routePoint(u);
      water = { cx: p.x, cy: p.y, rx: rand(120, 168), ry: rand(30, 42) };
    } else {
      const rx = rand(88, 126);
      const ry = rand(38, 52);
      const dx = mode === "left"
        ? -(greenRx + rx + rand(10, 24))
        : mode === "right"
          ? greenRx + rx + rand(10, 24)
          : rand(-20, 20);
      const cy = mode === "front"
        ? gy + greenRy + ry + rand(10, 18)
        : gy + rand(-12, 24);
      water = { cx: gx + dx, cy, rx, ry };
    }
  }
  const waterSideRight = !!water && water.cx > gx; // for greenside-bunker placement

  // A missed green should read as an off-green short-game lie, never as an
  // unmodelled penalty ball sitting in a pond. Prefer the front fringe, then
  // move around the green's collar until the marker clears the water shape.
  const shortCandidates = [
    { x: gx - greenRx * 0.72, y: gy + greenRy + 22 },
    { x: gx + greenRx * 0.72, y: gy + greenRy + 22 },
    { x: gx - greenRx - 20, y: gy + greenRy * 0.32 },
    { x: gx + greenRx + 20, y: gy + greenRy * 0.32 },
  ].map((p) => ({
    x: Math.min(620, Math.max(60, p.x)),
    y: Math.min(510, Math.max(92, p.y)),
  }));
  const waterEllipse = water ? { x: water.cx, y: water.cy, rx: water.rx, ry: water.ry } : null;
  const shortBallPt = pickDryBallPosition(
    shortCandidates,
    waterEllipse,
  );

  // Fairway/rough/trouble states use the same safety contract. Start at the
  // engine's progress, then try nearby points along the route. Off-fairway
  // lies can also switch sides, but retain their rough/trouble offset.
  const nearbyProgress = [t, t - 0.06, t + 0.06, t - 0.12, t + 0.12, t - 0.18, t + 0.18]
    .map((u) => Math.max(0.04, Math.min(0.96, u)));
  function liePointAt(u: number, side: number) {
    const line = linePointAt(u);
    const normal = routePerp(u);
    const offset = ballState === "rough"
      ? fairwayHalfWidthAt(u) + 24
      : ballState === "trouble"
        ? fairwayHalfWidthAt(u) + 62
        : 0;
    return { x: line.x + normal.x * offset * side, y: line.y + normal.y * offset * side };
  }
  const lieCandidates = nearbyProgress.flatMap((u) => {
    const preferred = liePointAt(u, lieSide);
    return ballState === "rough" || ballState === "trouble"
      ? [preferred, liePointAt(u, -lieSide)]
      : [preferred];
  });
  const lieBallPt = pickDryBallPosition(lieCandidates, waterEllipse);
  const ballPt = ballState === "short" ? shortBallPt : lieBallPt;

  // ---- Bunkers: seeded count / position / size, biased by hazard + difficulty.
  // Sand holes carry more (and sometimes clusters); harder holes carry more. ----
  const bunkers: Water[] = [];
  const fbCount = (isSand ? randInt(1, 3) : randInt(0, 2)) + (difficulty > 0.72 ? 1 : 0);
  for (let i = 0; i < fbCount; i++) {
    const u = rand(0.28, 0.82);
    const p = routePoint(u);
    const n = routePerp(u);
    const side = rng() < 0.5 ? 1 : -1;
    const off = fairwayHalfWidthAt(u) + rand(14, 40);
    const cx = p.x + n.x * off * side;
    const cy = p.y + n.y * off * side;
    const rx = rand(16, 34);
    bunkers.push({ cx, cy, rx, ry: rx * rand(0.5, 0.66) });
    // Occasionally a small satellite bunker -> a cluster instead of one blob.
    if (rng() < 0.34) bunkers.push({ cx: cx + rand(-26, 26), cy: cy + rand(20, 46), rx: rx * 0.6, ry: rx * 0.4 });
  }
  // Greenside bunker (usually present) on the side AWAY from any water guard.
  if (rng() < 0.85) {
    const side = water ? (waterSideRight ? -1 : 1) : (rng() < 0.5 ? 1 : -1);
    bunkers.push({
      cx: gx + side * (greenRx + rand(8, 22)),
      cy: gy + rand(-greenRy * 0.3, greenRy * 0.7),
      rx: rand(20, 30), ry: rand(11, 16),
    });
  }
  // Sand holes sometimes add a prominent front bunker biting into the green.
  if (isSand && rng() < 0.6) {
    bunkers.push({ cx: gx + rand(-30, 10), cy: gy - greenRy - rand(14, 30), rx: rand(16, 24), ry: rand(9, 13) });
  }
  // Keep every bunker on-canvas and clear of the deep bottom scrim.
  const clampedBunkers = bunkers.map((b) => ({
    ...b,
    cx: Math.min(602, Math.max(78, b.cx)),
    cy: Math.min(500, Math.max(105, b.cy)),
  }));

  const treesTopOnly = seededTrees(42, isOcean ? 390 : 500, randInt(3, 5));

  return (
    <svg viewBox="0 0 680 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {defs}

      {/* Base turf */}
      <rect width="680" height="560" fill="#8FAD7B" />

      {/* Ocean band along the bottom edge (seeded height) */}
      {isOcean && (() => {
        const topY = 472 + rand(-12, 10);
        return (
          <>
            <path d={`M0 560 L0 ${topY} C 190 ${topY + 30}, 500 ${topY - 24}, 680 ${topY + 4} L680 560 Z`} fill="url(#pond)" />
            <path d={`M0 ${topY} C 190 ${topY + 30}, 500 ${topY - 24}, 680 ${topY + 4}`} fill="none" stroke="#2F5A76" strokeWidth="2.5" opacity=".85" />
            <path d={`M70 ${topY + 44} Q 150 ${topY + 32} 230 ${topY + 44}`} fill="none" stroke="#79A8C4" strokeWidth="1.5" opacity=".5" />
            <path d={`M420 ${topY + 38} Q 500 ${topY + 26} 580 ${topY + 37}`} fill="none" stroke="#79A8C4" strokeWidth="1.5" opacity=".5" />
          </>
        );
      })()}

      {/* Tree framing — drawn first so the hole itself reads on top */}
      <g opacity=".78">{treesTopOnly.map((tr, i) => treeCluster(tr.x, tr.y, tr.s, `t${i}`))}</g>

      {/* Fairway ribbon — two-tone, bent through the dogleg elbow */}
      {!short && (
        <>
          <path d={fairwayPath} fill="none" stroke="#3F7D52" strokeWidth={flatFairwayWidth + 16} strokeLinecap="round" strokeLinejoin="round" />
          <path d={fairwayPath} fill="none" stroke="#74B788" strokeWidth={flatFairwayWidth} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {short && (
        // Minimal fairway for a one-shot par 3 — a short cut strip, not a route.
        <>
          <path d={fairwayPath} fill="none" stroke="#3F7D52" strokeWidth={flatFairwayWidth + 14} strokeLinecap="round" />
          <path d={fairwayPath} fill="none" stroke="#74B788" strokeWidth={flatFairwayWidth} strokeLinecap="round" />
        </>
      )}

      {/* Water hazard — a distinct body guarding/crossing, drawn under the green
          so the green sits clearly on its own turf apron (never an island) */}
      {water && (
        <>
          <ellipse cx={water.cx} cy={water.cy} rx={water.rx} ry={water.ry} fill="url(#pond)" stroke="#2F5A76" strokeWidth="3" />
          <path d={`M${water.cx - water.rx * 0.8} ${water.cy} Q ${water.cx} ${water.cy - 16} ${water.cx + water.rx * 0.8} ${water.cy}`} fill="none" stroke="#79A8C4" strokeWidth="2.5" opacity=".5" />
          <path d={`M${water.cx - water.rx * 0.6} ${water.cy + 16} Q ${water.cx} ${water.cy + 4} ${water.cx + water.rx * 0.6} ${water.cy + 16}`} fill="none" stroke="#79A8C4" strokeWidth="2" opacity=".4" />
        </>
      )}

      {/* Bunkers (before the green so the green apron overlaps them cleanly) */}
      {clampedBunkers.map((b, i) => bunkerShape(b.cx, b.cy, b.rx, b.ry, `b${i}`))}

      {/* Green: apron + mown-stripe surface */}
      <ellipse cx={gx} cy={gy} rx={greenRx + 10} ry={greenRy + 10} fill="#8CC275" />
      <ellipse cx={gx} cy={gy} rx={greenRx} ry={greenRy} fill="url(#mown)" stroke="rgba(19,32,26,.28)" strokeWidth="3" />

      {/* Tee marker */}
      <circle cx={teeX} cy={teeY} r="4.6" fill="#F7F4EA" stroke="#13201A" strokeWidth="1.4" />

      {/* Shot-line, tee -> pin, through the dogleg elbow */}
      <path
        d={`M${shotP0.x} ${shotP0.y} Q ${midpoint(shotP0, shotP1).x} ${midpoint(shotP0, shotP1).y} ${shotP1.x} ${shotP1.y} Q ${midpoint(shotP1, shotP2).x} ${midpoint(shotP1, shotP2).y} ${shotP2.x} ${shotP2.y}`}
        stroke="#F2C14E" strokeWidth="2.5" fill="none" opacity=".95"
      />
      <text
        x={routePoint(0.44).x} y={routePoint(0.44).y - 18}
        fill="#FFFFFF" stroke="#2F5A76" strokeWidth="4.5" paintOrder="stroke"
        fontSize="15" fontWeight="600" textAnchor="middle"
      >{yardage}</text>

      {/* Flagstick */}
      <line x1={pinX} y1={pinY} x2={pinX} y2={pinY - 58} stroke="#13201A" strokeWidth="2.5" />
      <path d={`M${pinX} ${pinY - 58} L ${pinX + 34} ${pinY - 48} L ${pinX} ${pinY - 38} Z`} fill="#C8493A" />

      {/* Ball marker along the shot-line at ballT */}
      <g>
        <circle cx={ballPt.x} cy={ballPt.y} r="4.6" fill="#F7F4EA" stroke="#13201A" strokeWidth="1.4" />
        <circle cx={ballPt.x} cy={ballPt.y} r="1.3" fill="#13201A" opacity=".3" />
      </g>

      {scrims}
    </svg>
  );
}
