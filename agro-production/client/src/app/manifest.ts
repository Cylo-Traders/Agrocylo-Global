import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Agrocylo Production",
    short_name: "Agro Production",
    description: "Agricultural production campaigns on Stellar",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16a34a",
    icons: [
      { src: "/icons/agro-production.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
