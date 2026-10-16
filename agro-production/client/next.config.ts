import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertEndpointsValid, assertApiWsOriginsValid } from "./src/lib/endpointValidator";
import { getAllowedProductImageHosts, getAllowedProductImageOrigins } from "./src/lib/productImagePolicy";
import { buildContentSecurityPolicy, observabilityConnectSources } from "./src/lib/cspPolicy";

// ── Resolve repository root for Turbopack ────────────────────────────────
// Issue #918: client fix derives repo root from config file location; this
// app lives at agro-production/client (depth 2), so resolve two levels up.
// Platform-safe, independent of process.cwd() / Windows separators.
function getRepoRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaUrl = (import.meta as any)?.url as string | undefined;
    if (metaUrl) {
      return path.resolve(path.dirname(fileURLToPath(metaUrl)), "../..");
    }
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaDir = (import.meta as any)?.dirname as string | undefined;
    if (metaDir) {
      return path.resolve(metaDir, "../..");
    }
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cjsDir = (globalThis as any).__dirname ?? (typeof __dirname !== "undefined" ? __dirname : undefined);
    if (cjsDir) {
      return path.resolve(cjsDir, "../..");
    }
  } catch {
    // ignore
  }
  // Fallback: cwd may be agro-production/client or root
  const cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}agro-production${path.sep}client`)) {
    return path.resolve(cwd, "../..");
  }
  if (cwd.endsWith(`${path.sep}client`)) {
    // Called from agro-production/client but cwd truncated? resolve up.
    return path.resolve(cwd, "../..");
  }
  return path.resolve(cwd);
}

const repoRoot = getRepoRoot();

// ── Validate endpoints before using them for headers/images ─────────────
// Mirrors client/next.config.ts validation (Issue #927). In production missing
// endpoints block the build; in dev malformed values still fail predictably
// with variable-named guidance and no secret echo.
function validateNetworkConfig() {
  const isProd = process.env.NODE_ENV === "production";
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
}

validateNetworkConfig();

// For headers/images we reuse the validated hostnames (dev fallback handled by validator)
const { sorobanRpc, horizon: horizonHostname } = assertEndpointsValid(
  {
    NEXT_PUBLIC_SOROBAN_RPC_URL: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
    NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
    NEXT_PUBLIC_NETWORK_PASSPHRASE: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
    NEXT_PUBLIC_STELLAR_ENV: process.env.NEXT_PUBLIC_STELLAR_ENV,
    NODE_ENV: process.env.NODE_ENV,
  },
  { isProduction: process.env.NODE_ENV === "production" }
);

// Issue #1001: allow a separately hosted API/WebSocket origin (e.g. localhost:5001
// in dev, or a dedicated api./ws. host in production) through the CSP connect-src.
// Both are optional -- same-origin deployments leave them unset and rely on 'self'.
const { apiOrigin, wsOrigin } = assertApiWsOriginsValid(
  {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
  { isProduction: process.env.NODE_ENV === "production" }
);

const productImageHosts = getAllowedProductImageHosts();
const productImageOrigins = getAllowedProductImageOrigins();
const productImagePatterns = productImageOrigins.map((origin) => {
  const url = new URL(origin);
  return { protocol: url.protocol.replace(":", "") as "http" | "https", hostname: url.hostname };
});

const nextConfig: NextConfig = {
  output: "standalone",
  // Issue #755: shared monorepo packages ship raw TS source, so Next.js
  // needs to be told to transpile them like any other app source file.
  transpilePackages: ["@agrocylo/wallet-core"],
  turbopack: {
    root: repoRoot,
  },
  // Keep CSP/image hosts in sync with the validated endpoints so a
  // malformed value never reaches `new URL(...).hostname` as a generic throw.
  async headers() {
    const imageHosts = ["ipfs.io", "gateway.pinata.cloud", sorobanRpc, horizonHostname, ...productImageHosts].filter(Boolean);
    const cspImageSources = [...new Set([...imageHosts.map((h) => `https://${h}`), ...productImageOrigins])].join(" ");
    const apiWsOrigins = [apiOrigin, wsOrigin].filter((o): o is string => Boolean(o));
    const cspConnectSources = [`https://${sorobanRpc}`, `https://${horizonHostname}`, "https://freighter.app", ...new Set(apiWsOrigins)];
    // Issue #1040: Sentry and first-party telemetry are configured via env but
    // were never in connect-src, so their requests were blocked in production.
    // Only origins the code actually validates are added, and only for features
    // that are enabled -- an unset variable must not widen the policy.
    const { origins: cspObservabilitySources, rejected: rejectedObservability } = observabilityConnectSources({
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      NEXT_PUBLIC_TELEMETRY_ENABLED: process.env.NEXT_PUBLIC_TELEMETRY_ENABLED,
      NEXT_PUBLIC_TELEMETRY_URL: process.env.NEXT_PUBLIC_TELEMETRY_URL,
      NODE_ENV: process.env.NODE_ENV,
    });
    if (rejectedObservability.length > 0) {
      // Names only. The values may contain a DSN public key, which is not a
      // secret but does not belong in build logs either.
      console.warn(
        `[csp] ignoring malformed observability origin(s): ${rejectedObservability.join(", ")}`,
      );
    }
    const contentSecurityPolicy = buildContentSecurityPolicy({
      isProduction: process.env.NODE_ENV === "production",
      // No nonce here: this is the static baseline for requests that do not
      // pass through middleware. src/middleware.ts generates a per-request
      // nonce and forwards it, which is what allows hydration (#1039).
      nonce: null,
      imageSources: cspImageSources.split(" ").filter(Boolean),
      connectSources: cspConnectSources,
      observabilitySources: cspObservabilitySources,
    });
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  images: {
    qualities: [75, 100],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: sorobanRpc },
      { protocol: "https", hostname: horizonHostname },
      ...productImagePatterns,
    ],
  },
};

export default nextConfig;
