export const ALLOWED_PROTOCOLS = ["https:", "http:"] as const;
export const ALLOWED_WS_PROTOCOLS = ["wss:", "ws:"] as const;
const INSECURE_PROTOCOLS = new Set(["http:", "ws:"]);
export const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export interface SingleValidationResult {
  varName: string;
  hostname: string | null;
  /** scheme + host + port only (no path/query/credentials) — safe to place verbatim in a CSP source list. */
  origin: string | null;
  error: string | null;
  /** Effective fallback hostname when value is absent and not required (null = no fallback). */
  fallbackUsed: boolean;
}

function isLocalhost(hostname: string): boolean {
  return LOCALHOST_HOSTS.has(hostname.toLowerCase());
}

/**
 * Validate a single endpoint URL without echoing the raw value.
 *
 * @param varName - Environment variable name (e.g. NEXT_PUBLIC_SOROBAN_RPC_URL)
 * @param rawValue - Raw env value (may be undefined / empty / malformed)
 * @param options.required - When true, missing/empty is an error. When false, missing returns fallbackUsed=true.
 * @param options.allowedProtocols - Defaults to https:/http:. Pass ALLOWED_WS_PROTOCOLS for ws/wss endpoints.
 */
export function validateEndpointUrl(
  varName: string,
  rawValue: string | undefined | null,
  options: { required: boolean; allowedProtocols?: readonly string[] }
): SingleValidationResult {
  const allowedProtocols = options.allowedProtocols ?? ALLOWED_PROTOCOLS;
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!trimmed) {
    if (options.required) {
      return {
        varName,
        hostname: null,
        origin: null,
        fallbackUsed: false,
        error:
          `${varName} is missing or empty. ` +
          `Set it in your .env.local or deployment environment ` +
          `(e.g., https://soroban-testnet.stellar.org for testnet, https://soroban-rpc.mainnet.stellar.org for mainnet). ` +
          `See docs/deployment/environment.md and client/.env.example. ` +
          `Do not include credentials, tokens, or query strings.`,
      };
    }
    return { varName, hostname: null, origin: null, error: null, fallbackUsed: true };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      varName,
      hostname: null,
      origin: null,
      fallbackUsed: false,
      error:
        `${varName} is not a valid URL (e.g., http://localhost:8000). ` +
        `Check your .env.local or deployment environment and remove any credentials, tokens, or query strings. ` +
        `See docs/deployment/environment.md and client/.env.example.`,
    };
  }

  if (!allowedProtocols.includes(url.protocol as typeof allowedProtocols[number])) {
    return {
      varName,
      hostname: null,
      origin: null,
      fallbackUsed: false,
      error:
        `${varName} uses an unsupported scheme "${url.protocol}". ` +
        `Supported schemes are ${allowedProtocols.join(", ")}. ` +
        `Set ${varName} to a valid URL using one of those schemes. See docs/deployment/environment.md.`,
    };
  }

  if (INSECURE_PROTOCOLS.has(url.protocol) && !isLocalhost(url.hostname)) {
    return {
      varName,
      hostname: null,
      origin: null,
      fallbackUsed: false,
      error:
        `${varName} uses ${url.protocol} for a non-local host. ` +
        `Use a secure scheme (https:/wss:) for remote endpoints; ${url.protocol} is only allowed for localhost/127.0.0.1 development. ` +
        `Set ${varName} to a valid secure URL. See docs/deployment/environment.md.`,
    };
  }

  if (!url.hostname) {
    return {
      varName,
      hostname: null,
      origin: null,
      fallbackUsed: false,
      error:
        `${varName} is malformed (missing hostname). ` +
        `Set it to a valid URL such as https://soroban-testnet.stellar.org. See docs/deployment/environment.md.`,
    };
  }

  // Reject embedded credentials to avoid leaking secrets via hostname derivation
  if (url.username || url.password) {
    return {
      varName,
      hostname: null,
      origin: null,
      fallbackUsed: false,
      error:
        `${varName} must not contain embedded credentials (username/password). ` +
        `Remove credentials and use environment-native secret management instead. ` +
        `Set ${varName} to a plain https:// URL.`,
    };
  }

  // hostname/origin is safe to expose; full URL / query / path is not echoed
  return { varName, hostname: url.hostname, origin: url.origin, error: null, fallbackUsed: false };
}

export interface EndpointsEnv {
  NEXT_PUBLIC_SOROBAN_RPC_URL?: string;
  NEXT_PUBLIC_HORIZON_URL?: string;
  NEXT_PUBLIC_NETWORK_PASSPHRASE?: string;
  NEXT_PUBLIC_STELLAR_ENV?: string;
  NODE_ENV?: string;
}

export interface ValidateEndpointsOptions {
  /** When true, missing RPC/passphrase is an error (production). When false, dev fallback is allowed. */
  isProduction: boolean;
  /** Optional: when false, Horizon is strictly optional (dev). When true, Horizon required if set? keep optional always. */
  horizonRequired?: boolean;
}

export interface EndpointsValidationResult {
  errors: string[];
  invalidVars: string[];
  hostnames: {
    sorobanRpc: string | null;
    horizon: string | null;
  };
}

/**
 * Validate all stellar endpoints at once, collecting every relevant error
 * so the caller can report all invalid variable names together.
 */
export function validateEndpoints(
  env: EndpointsEnv,
  options: ValidateEndpointsOptions
): EndpointsValidationResult {
  const isProd = options.isProduction;
  // Horizon is optional in both dev and prod; we only validate if present/malformed.
  // If caller passes horizonRequired=true it becomes required.
  const horizonRequired = options.horizonRequired ?? false;

  const rpcResult = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", env.NEXT_PUBLIC_SOROBAN_RPC_URL, {
    required: isProd,
  });
  const horizonResult = validateEndpointUrl("NEXT_PUBLIC_HORIZON_URL", env.NEXT_PUBLIC_HORIZON_URL, {
    required: horizonRequired,
  });

  const errors: string[] = [];
  const invalidVars: string[] = [];
  if (rpcResult.error) {
    errors.push(rpcResult.error);
    invalidVars.push(rpcResult.varName);
  }
  if (horizonResult.error) {
    errors.push(horizonResult.error);
    invalidVars.push(horizonResult.varName);
  }

  // Also validate passphrase requirement mirrors networkConfig / next.config logic
  const passphrase = (env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "").trim();
  if (!passphrase && isProd) {
    const msg =
      `NEXT_PUBLIC_NETWORK_PASSPHRASE is missing or empty. ` +
      `Set it in your .env.local or deployment environment ` +
      `(e.g., "Test SDF Network ; September 2015" for testnet or "Public Global Stellar Network ; September 2015" for mainnet). ` +
      `See docs/deployment/environment.md and client/.env.example.`;
    errors.push(msg);
    invalidVars.push("NEXT_PUBLIC_NETWORK_PASSPHRASE");
  }

  // Resolve effective hostnames:
  // - For required/malformed we already have errors; hostnames stay null.
  // - For optional absent we fall back to defaults (dev) or leave null (prod will have errored).
  let sorobanRpc: string | null = rpcResult.hostname;
  let horizon: string | null = horizonResult.hostname;

  if (rpcResult.fallbackUsed) {
    // Dev fallback preserves prior behavior; prod never reaches here because required=true.
    sorobanRpc = new URL("https://soroban-testnet.stellar.org").hostname;
  }
  if (horizonResult.fallbackUsed) {
    horizon = new URL("https://horizon-testnet.stellar.org").hostname;
  }

  return { errors, invalidVars, hostnames: { sorobanRpc, horizon } };
}

/**
 * Validate and throw a combined, variable-named error without echoing secrets.
 * Used directly by next.config.ts during config evaluation.
 */
export function assertEndpointsValid(
  env: EndpointsEnv,
  options: ValidateEndpointsOptions
): { sorobanRpc: string; horizon: string } {
  const result = validateEndpoints(env, options);
  if (result.errors.length > 0) {
    const header =
      `Invalid Stellar endpoint configuration (${result.invalidVars.join(", ")}). ` +
      `Fix the listed variable(s) in your .env.local or deployment environment. ` +
      `Do not include credentials, tokens, or query strings in endpoint values.`;
    const body = result.errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
    const guidance =
      `\nActionable guidance:\n` +
      `- For local development you may use http://localhost:8000 for Soroban RPC or Horizon when running a local container.\n` +
      `- For remote endpoints use https:// (e.g., https://soroban-testnet.stellar.org, https://horizon-testnet.stellar.org).\n` +
      `- See docs/deployment/environment.md and client/.env.example for required/optional notes.\n` +
      `- Diagnostic output intentionally omits endpoint values to avoid leaking secrets.`;

    throw new Error(`${header}\n${body}${guidance}`);
  }
  // At this point hostnames must be non-null (fallback or validated)
  return {
    sorobanRpc: result.hostnames.sorobanRpc!,
    horizon: result.hostnames.horizon!,
  };
}

export interface ApiWsEnv {
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_WS_URL?: string;
  NODE_ENV?: string;
}

export interface ApiWsValidationResult {
  errors: string[];
  invalidVars: string[];
  origins: {
    api: string | null;
    ws: string | null;
  };
}

/**
 * Validate the separately-hosted API/WebSocket endpoints (Issue #1001).
 * Both are optional: a same-origin deployment sets neither and relies on 'self'.
 * When set, they must be well-formed and — outside localhost — use a secure scheme.
 */
export function validateApiWsOrigins(
  env: ApiWsEnv,
  options: { isProduction: boolean }
): ApiWsValidationResult {
  const apiResult = validateEndpointUrl("NEXT_PUBLIC_API_URL", env.NEXT_PUBLIC_API_URL, {
    required: false,
    allowedProtocols: ALLOWED_PROTOCOLS,
  });
  const wsResult = validateEndpointUrl("NEXT_PUBLIC_WS_URL", env.NEXT_PUBLIC_WS_URL, {
    required: false,
    allowedProtocols: ALLOWED_WS_PROTOCOLS,
  });

  const errors: string[] = [];
  const invalidVars: string[] = [];
  if (apiResult.error) {
    errors.push(apiResult.error);
    invalidVars.push(apiResult.varName);
  }
  if (wsResult.error) {
    errors.push(wsResult.error);
    invalidVars.push(wsResult.varName);
  }

  // In production, if a scheme was provided it must already be secure (enforced above);
  // this just guards against a http:// value slipping through as "valid" for a remote host.
  if (options.isProduction) {
    if (apiResult.origin && apiResult.origin.startsWith("http://") && !apiResult.origin.includes("localhost")) {
      errors.push(`NEXT_PUBLIC_API_URL must use https:// in production.`);
      invalidVars.push("NEXT_PUBLIC_API_URL");
    }
    if (wsResult.origin && wsResult.origin.startsWith("ws://") && !wsResult.origin.includes("localhost")) {
      errors.push(`NEXT_PUBLIC_WS_URL must use wss:// in production.`);
      invalidVars.push("NEXT_PUBLIC_WS_URL");
    }
  }

  return {
    errors,
    invalidVars,
    origins: { api: apiResult.origin, ws: wsResult.origin },
  };
}

/**
 * Validate and throw for the API/WS pair, mirroring assertEndpointsValid.
 * Returns exact origins (scheme+host+port, no path/query/credentials) ready
 * to drop into a CSP connect-src list.
 */
export function assertApiWsOriginsValid(
  env: ApiWsEnv,
  options: { isProduction: boolean }
): { apiOrigin: string | null; wsOrigin: string | null } {
  const result = validateApiWsOrigins(env, options);
  if (result.errors.length > 0) {
    const header =
      `Invalid API/WebSocket endpoint configuration (${result.invalidVars.join(", ")}). ` +
      `Fix the listed variable(s) in your .env.local or deployment environment. ` +
      `Do not include credentials, tokens, or query strings in endpoint values.`;
    const body = result.errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
    const guidance =
      `\nActionable guidance:\n` +
      `- Leave NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL unset for same-origin deployments.\n` +
      `- For a separately hosted API/WS, use exact origins (e.g., https://api.example.com, wss://ws.example.com).\n` +
      `- Local development may use http://localhost:5001 / ws://localhost:5001.\n` +
      `- Diagnostic output intentionally omits endpoint values to avoid leaking secrets.`;

    throw new Error(`${header}\n${body}${guidance}`);
  }
  return { apiOrigin: result.origins.api, wsOrigin: result.origins.ws };
}