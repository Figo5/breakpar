import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { coursePar, courseBySlug } from "@/data/courses";
import { puzzleNumberForKey } from "@/lib/daily";
import { relativeLabel, brokePar } from "@/lib/scoring";
import { type Outcome } from "@/lib/engine/probabilities";

// Per-round link-preview card. Runs UNAUTHENTICATED (link unfurlers have no
// session) and degrades to a branded fallback for a missing/invalid id — never
// a crash. Node runtime so it can read the round via Prisma (same as the page).
export const runtime = "nodejs";
export const alt = "Break Par result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Cell colours MIRROR the OUTCOME_META emoji squares (🟦🟩⬜🟨🟧🟥) — we render
// solid cells instead of emoji because colour glyphs are unreliable in next/og.
const CELL: Record<Outcome, string> = {
  eagle: "#4A90D9", // 🟦
  birdie: "#46955F", // 🟩
  par: "#E9E3D2", // ⬜
  bogey: "#E0A02B", // 🟨
  double: "#E0792B", // 🟧
  triple: "#D7402F", // 🟥
};

const FAIRWAY = "#143728";
const CREAM = "#F7F3E8";
const FLAG = "#D7402F";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: `linear-gradient(135deg, #1f5b3f 0%, ${FAIRWAY} 55%, #0e2a1d 100%)`,
        color: CREAM,
        padding: "64px 72px",
        fontFamily: "sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function Wordmark({ small }: { small?: boolean }) {
  return (
    <div style={{ display: "flex", fontSize: small ? 40 : 64, fontWeight: 800, letterSpacing: -1 }}>
      <span>BREAK </span>
      <span style={{ color: FLAG, marginLeft: 14 }}>PAR</span>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;

  // Fallback used for any missing/invalid round — branded, never a 500.
  const fallback = () =>
    new ImageResponse(
      (
        <Shell>
          <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 18 }}>
            <Wordmark />
            <div style={{ display: "flex", fontSize: 30, opacity: 0.85 }}>One real course a day. Can you break par?</div>
          </div>
          <div style={{ display: "flex", fontSize: 26, opacity: 0.8 }}>breakpar.xyz</div>
        </Shell>
      ),
      { ...size }
    );

  let round;
  try {
    round = await prisma.round.findUnique({
      where: { id: roundId },
      select: {
        score: true,
        relativeToPar: true,
        mode: true,
        dateKey: true,
        holeResults: { orderBy: { holeNumber: "asc" }, select: { outcome: true } },
        course: { select: { slug: true } },
      },
    });
  } catch {
    return fallback();
  }
  if (!round) return fallback();

  const course = courseBySlug(round.course.slug);
  if (!course) return fallback();

  const par = coursePar(course);
  const courseName = course.name.split("—")[0].trim();
  const isDaily = round.mode === "daily" && !!round.dateKey;
  const puzzleNo = round.dateKey ? puzzleNumberForKey(round.dateKey) : null;
  const made = brokePar(round.score, par);
  const outcomes = round.holeResults.map((h) => h.outcome as Outcome);

  // 18 cells in hole order; pad faint cells if the round is unfinished.
  const cells: (Outcome | null)[] = Array.from({ length: 18 }, (_, i) => outcomes[i] ?? null);
  const row = (slice: (Outcome | null)[]) => (
    <div style={{ display: "flex", gap: 10 }}>
      {slice.map((o, i) => (
        <div
          key={i}
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: o ? CELL[o] : "rgba(247,243,232,0.12)",
          }}
        />
      ))}
    </div>
  );

  return new ImageResponse(
    (
      <Shell>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Wordmark small />
          <div style={{ display: "flex", fontSize: 28, fontWeight: 600, opacity: 0.85, letterSpacing: 2 }}>
            {isDaily ? `NO. ${puzzleNo}` : "PRACTICE"}
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 26 }}>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, opacity: 0.95 }}>{courseName}</div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 26 }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 800, lineHeight: 1, color: CREAM }}>{round.score}</div>
            <div
              style={{
                display: "flex",
                marginBottom: 22,
                fontSize: 46,
                fontWeight: 800,
                color: made ? "#7BD0A0" : FLAG,
              }}
            >
              {relativeLabel(round.relativeToPar)}
            </div>
            <div style={{ display: "flex", marginBottom: 26, fontSize: 30, fontWeight: 600, opacity: 0.85 }}>
              {made ? "UNDER PAR" : `PAR ${par}`}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {row(cells.slice(0, 9))}
            {row(cells.slice(9, 18))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>breakpar.xyz</div>
          <div style={{ display: "flex", fontSize: 26, opacity: 0.8 }}>Can you break par?</div>
        </div>
      </Shell>
    ),
    { ...size }
  );
}
