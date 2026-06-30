/**
 * Demo (no DB / no migration needed): shows how a user WITH an X handle and a
 * user WITHOUT one render on the leaderboard rows and in the share text, using
 * the exact same helpers + composition the result page uses. Run:
 *   npx tsx scripts/demo-x-handle.ts
 */
import { xHandleLabel, xHandleUrl } from "@/lib/xHandle";

type Row = { rank: number; username: string; xHandle: string | null; durationMs: number | null; score: number };

const board: Row[] = [
  { rank: 1, username: "gio", xHandle: "steelo555", durationMs: 41000, score: 71 },
  { rank: 2, username: "Guest-9f2a", xHandle: null, durationMs: 58000, score: 74 },
];

function renderRow(r: Row): string {
  const handle = r.xHandle
    ? `\n      <a class="xh" href="${xHandleUrl(r.xHandle)}">${xHandleLabel(r.xHandle)}</a>`
    : "";
  return `  <div class="lb-row">
    <span class="rank">${r.rank}</span>
    <span class="nm">${r.username}${handle}</span>
    <span class="tm">${Math.round((r.durationMs ?? 0) / 1000)}s</span>
    <span class="sc">${r.score}</span>
  </div>`;
}

console.log("=== LEADERBOARD ===");
console.log(board.map(renderRow).join("\n"));

const grid = "🟩🟩🟨🟩🟥🟩🟩🟨🟩\n🟩🟩🟩🟨🟩🟩🟥🟩🟩";
function shareText(handle: string | null): string {
  const handleLine = handle ? `\n${xHandleLabel(handle)}` : "";
  return `BREAK PAR #42 ⛳\nPebble Creek (Par 72)\n71 (-1)\n\n${grid}\nTop 3% so far today${handleLine}\n\n🐦 4  ·  ⛳ 11  ·  😬 3\nbreakpar.xyz`;
}

console.log("\n=== SHARE (handle user: steelo555) ===");
console.log(shareText("steelo555"));
console.log("\n=== SHARE (handle-less user) ===");
console.log(shareText(null));
