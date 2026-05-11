import type { NextConfig } from "next";

const cwd = process.cwd().replace(/\\/g, "/");
const clientRoot = cwd.endsWith("/client")
  ? process.cwd()
  : `${process.cwd()}\\client`;

const nextConfig: NextConfig = {
  turbopack: {
    root: clientRoot,
  },
  images: {
    qualities: [75, 100],
  },
};

export default nextConfig;
