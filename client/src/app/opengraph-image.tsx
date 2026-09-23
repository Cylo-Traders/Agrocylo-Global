import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site.config";

export const runtime = "nodejs";
export const alt = siteConfig.ogTitle;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          background:
            "linear-gradient(135deg, #0d1f0e 0%, #0f2d10 40%, #1a3d1c 100%)",
          padding: "72px 80px",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(74,222,128,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(74,222,128,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        {/* Glow orb */}
        <div
          style={{
            position: "absolute",
            top: "-120px",
            right: "-80px",
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(74,222,128,0.12) 0%, transparent 70%)",
          }}
        />

        {/* Logo pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            marginBottom: "40px",
            background: "rgba(74,222,128,0.1)",
            border: "1px solid rgba(74,222,128,0.25)",
            borderRadius: "100px",
            padding: "10px 24px 10px 10px",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: "#4ade80",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              fontWeight: "bold",
              color: "#0d1f0e",
            }}
          >
            🌾
          </div>
          <span
            style={{
              color: "#4ade80",
              fontSize: "20px",
              fontWeight: "700",
              letterSpacing: "-0.02em",
            }}
          >
            AgroCylo
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: "64px",
            fontWeight: "800",
            color: "#ffffff",
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            marginBottom: "24px",
            maxWidth: "800px",
          }}
        >
          Fair Trade.{" "}
          <span style={{ color: "#4ade80" }}>On-chain.</span>
          {"\n"}For Every Farmer.
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: "22px",
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1.5,
            maxWidth: "700px",
            marginBottom: "48px",
          }}
        >
          The Agro-DeFi marketplace connecting farmers directly with buyers,
          settled by Stellar escrow.
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(74,222,128,0.15)",
              border: "1px solid rgba(74,222,128,0.3)",
              borderRadius: "8px",
              padding: "8px 16px",
            }}
          >
            <span
              style={{
                color: "#4ade80",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              Powered by Stellar
            </span>
          </div>
          <span
            style={{ color: "rgba(255,255,255,0.3)", fontSize: "14px" }}
          >
            {siteConfig.url.replace("https://", "")}
          </span>
        </div>
      </div>
    ),
    size,
  );
}
