import { ImageResponse } from "next/og";

// ponytail: code-rendered share card — no design tool, no static asset to maintain.
// Swap for a real public/og.png screenshot if you want richer art.
export const alt = "Break Par — daily golf challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#143728",
          color: "#f5f5f0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -2 }}>Break Par</div>
        <div style={{ fontSize: 44, marginTop: 24, color: "#a8d5b5" }}>
          One real course a day. 18 holes, one decision each.
        </div>
        <div style={{ fontSize: 36, marginTop: 40, fontWeight: 600 }}>Can you break par? →  breakpar.xyz</div>
      </div>
    ),
    { ...size }
  );
}
