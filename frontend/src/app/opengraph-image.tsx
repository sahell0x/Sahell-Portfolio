import { ImageResponse } from "next/og";
import { profile } from "@/content";

export const alt = `${profile.name} — ${profile.title}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          background: "#ffffff",
          color: "#101112",
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            fontSize: 104,
            fontWeight: 700,
            letterSpacing: "-3px",
            lineHeight: 1,
          }}
        >
          {profile.name}
        </div>

        <div style={{ marginTop: 24, fontSize: 40, color: "#55595e" }}>
          {profile.title}
        </div>

        <div
          style={{
            marginTop: 40,
            width: 260,
            height: 1,
            background: "#cbcfd3",
          }}
        />

        <div
          style={{
            marginTop: 40,
            fontSize: 26,
            color: "#55595e",
            maxWidth: 900,
            lineHeight: 1.4,
          }}
        >
          Production AI systems, end-to-end — voice agents, RAG pipelines, and
          self-hosted LLM infrastructure.
        </div>

        <div
          style={{
            marginTop: 48,
            display: "flex",
            gap: 12,
            fontSize: 22,
            color: "#8b9095",
          }}
        >
          github.com/sahell0x · portfolio.sahellx.site
        </div>
      </div>
    ),
    { ...size }
  );
}
