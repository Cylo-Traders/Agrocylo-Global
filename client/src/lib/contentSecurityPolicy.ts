export interface CspEnvironment {
  [key: string]: string | undefined;
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_SOROBAN_RPC_URL?: string;
  NEXT_PUBLIC_HORIZON_URL?: string;
  NEXT_PUBLIC_ANALYTICS_ENDPOINT?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
}

interface CspOptions {
  nonce: string;
  isDevelopment: boolean;
  requestOrigin: string;
  env?: CspEnvironment;
}

const DEFAULT_API_URL = "http://localhost:5000";
const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";

function originOf(value?: string): string | undefined {
  if (!value || value.startsWith("/")) return undefined;

  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function websocketOriginOf(value?: string): string | undefined {
  const origin = originOf(value);
  if (!origin) return undefined;

  const url = new URL(origin);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else return url.origin;
  return url.origin;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
  requestOrigin,
  env = process.env,
}: CspOptions): string {
  const apiUrl = env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  const rpcUrl = env.NEXT_PUBLIC_SOROBAN_RPC_URL || DEFAULT_RPC_URL;
  const horizonUrl = env.NEXT_PUBLIC_HORIZON_URL || DEFAULT_HORIZON_URL;

  const connectSources = unique([
    "'self'",
    originOf(apiUrl),
    websocketOriginOf(apiUrl),
    originOf(rpcUrl),
    originOf(horizonUrl),
    originOf(env.NEXT_PUBLIC_ANALYTICS_ENDPOINT),
    originOf(env.NEXT_PUBLIC_SENTRY_DSN),
    isDevelopment ? websocketOriginOf(requestOrigin) : undefined,
  ]);

  const imageSources = unique([
    "'self'",
    "data:",
    "blob:",
    "https://ipfs.io",
    "https://gateway.pinata.cloud",
    "https://api.qrserver.com",
    "https://unpkg.com",
    "https://*.tile.openstreetmap.org",
    originOf(rpcUrl),
    originOf(horizonUrl),
  ]);

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
