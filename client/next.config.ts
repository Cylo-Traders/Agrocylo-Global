import type { NextConfig } from "next";

// ── Build-time validation for required network configuration ──
// Fail fast if critical env vars are missing, preventing silent failures
// where a production build accidentally uses testnet or wrong network.
function validateNetworkConfig() {
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const networkPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;

  if (!rpcUrl) {
    console.error(
      "❌ NEXT_PUBLIC_SOROBAN_RPC_URL is not set. " +
      "This is required to connect to the Stellar network. " +
      "Set it in your .env.local or deployment environment."
    );
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_SOROBAN_RPC_URL is required for production builds. " +
        "Set this environment variable before building."
      );
    }
  }

  if (!networkPassphrase) {
    console.error(
      "❌ NEXT_PUBLIC_NETWORK_PASSPHRASE is not set. " +
      "This is required to sign transactions correctly. " +
      "Set it in your .env.local or deployment environment."
    );
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_NETWORK_PASSPHRASE is required for production builds. " +
        "Set this environment variable before building."
      );
    }
  }

  if (rpcUrl && networkPassphrase) {
    const isMainnet = networkPassphrase === "Public Global Stellar Network ; September 2015";
    const isTestnet = networkPassphrase === "Test SDF Network ; September 2015";

    if (!isMainnet && !isTestnet) {
      console.warn(
        "⚠️  Unknown network passphrase: " + networkPassphrase +
        ". Ensure this matches your RPC endpoint."
      );
    }

    console.log(
      `✓ Network config validated: ${isMainnet ? "MAINNET" : isTestnet ? "TESTNET" : "CUSTOM"}`
    );
  }
}

validateNetworkConfig();

const cwd = process.cwd().replace(/\\/g, "/");
const clientRoot = cwd.endsWith("/client")
  ? process.cwd()
  : `${process.cwd()}\\client`;

const sorobanRpc = new URL(process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org").hostname;
const horizonHostname = new URL(process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org").hostname;

async function headers() {
  const imageHosts = [
    "ipfs.io",
    "gateway.pinata.cloud",
    sorobanRpc,
    horizonHostname,
  ].filter(Boolean);

  const cspImageSources = imageHosts.map(host => `https://${host}`).join(" ");
  const cspConnectSources = [
    `https://${sorobanRpc}`,
    `https://${horizonHostname}`,
    "https://freighter.app",
  ].join(" ");

  return [
    {
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' ${cspImageSources}; connect-src 'self' ${cspConnectSources}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
  headers,
  turbopack: {
    root: clientRoot,
  },
  images: {
    qualities: [75, 100],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: sorobanRpc },
      { protocol: "https", hostname: horizonHostname },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons']
  }
};

export default nextConfig;
