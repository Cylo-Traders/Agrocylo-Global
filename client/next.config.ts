import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n.ts');

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
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    formats: ['image/avif', 'image/webp']
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons']
  }
};

export default withNextIntl(nextConfig);
