import { ImageResponse } from "next/og";
export const alt = "SAVA est.2026 — beauty studio, Minsk";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#a20b39",
        color: "#f7f3ee",
        padding: "70px",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 22,
        }}
      >
        <span>BEAUTY STUDIO</span>
        <span>MINSK</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 210,
          letterSpacing: "-18px",
          lineHeight: 1,
        }}
      >
        SAVA
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 24,
        }}
      >
        <span>FACE MASSAGE / MANICURE / PEDICURE</span>
        <span>est.2026</span>
      </div>
    </div>,
    size,
  );
}
