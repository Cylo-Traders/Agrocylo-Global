import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site.config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cylo — Agro-DeFi Marketplace on Stellar",
    short_name: "Cylo",
    description: siteConfig.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0d1f0e",
    theme_color: "#4ade80",
    orientation: "portrait-primary",
    categories: ["finance", "shopping", "agriculture"],
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

// pwa feature
