import path from "node:path";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertEndpointsValid } from "./src/lib/endpointValidator";

// ── Resolve repository root for Turbopack ────────────────────────────────
// Issue #918: previous implementation used process.cwd() + a literal Windows
// separator, which fails when dev is launched from client/ vs root and on
// non-Windows hosts. Derive from the config file location with
// platform-safe path APIs.
function getRepoRoot(): string {
  // ESM: import.meta.url
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaUrl = (import.meta as any)?.url as string | undefined;
    if (metaUrl) {
      return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
    }
  } catch {
    // ignore
  }
  // Node 20.11+ exposes import.meta.dirname
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaDir = (import.meta as any)?.dirname as string | undefined;
    if (metaDir) {
      return path.resolve(metaDir, "..");
    }
  } catch {
    // ignore
  }
  // CJS fallback (some Next.js loaders still use require)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cjsDir = (globalThis as any).__dirname ?? (typeof __dirname !== "undefined" ? __dirname : undefined);
    if (cjsDir) {
      return path.resolve(cjsDir, "..");
    }
  } catch {
    // ignore
  }
  // Last resort: cwd is client/ or root. Resolve up one level if we detect client suffix.
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}client`) ? path.resolve(cwd, "..") : path.resolve(cwd);
}

const repoRoot = getRepoRoot();

// ── Build-time validation for required network configuration ──
// Fail fast if critical env vars are missing, preventing silent failures
// where a production build accidentally uses testnet or wrong network.
// Issue #927: delegate URL format/scheme checks to endpointValidator so
// malformed values fail with variable-specific guidance, not generic Invalid URL.
// Do not echo secrets / query tokens / full endpoint values.
function validateNetworkConfig() {
  const isProd = process.env.NODE_ENV === "production";

  // EndpointValidator covers missing/empty, malformed, unsupported scheme,
  // and http-only-for-localhost rules. It reports ALL invalid vars at once
  // and never echoes raw values.
  assertEndpointsValid(
    {
      NEXT_PUBLIC_SOROBAN_RPC_URL: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
      NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
      NEXT_PUBLIC_NETWORK_PASSPHRASE: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
      NEXT_PUBLIC_STELLAR_ENV: process.env.NEXT_PUBLIC_STELLAR_ENV,
      NODE_ENV: process.env.NODE_ENV,
    },
    { isProduction: isProd }
  );

  // Preserve passphrase network-mismatch warning from original validator
  const networkPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
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
  } else if (!isProd) {
    // In dev, passphrase may be intentionally absent (fallback to testnet) — don't spam.
    // In prod the assert above already threw.
    console.log("ℹ️  Network config: using defaults for local development (set NEXT_PUBLIC_SOROBAN_RPC_URL / NEXT_PUBLIC_NETWORK_PASSPHRASE in .env.local for a specific network).");
  }
}

validateNetworkConfig();

// Dependencies are hoisted to the repository root by the npm workspace
// (Issue #755), so the bundler root has to be the workspace root — pointing it
// at the app directory puts `next` itself outside the root and reproduces the
// "couldn't find the Next.js package" / build-manifest ENOENT startup failure.
// `__dirname` (never process.cwd()) keeps this stable when the app is started
// through Turborepo or from another directory.
const workspaceRoot = path.resolve(__dirname, "..");

const sorobanRpc = new URL(process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org").hostname;
const horizonHostname = new URL(process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org").hostname;

async function headers() {
  return [
    {
      source: "/:path*",
      headers: [
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
    root: workspaceRoot,
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
