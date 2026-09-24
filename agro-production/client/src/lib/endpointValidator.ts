/**
 * Endpoint URL validator for Next.js config evaluation.
 *
 * Validates NEXT_PUBLIC_SOROBAN_RPC_URL and NEXT_PUBLIC_HORIZON_URL before
 * they are passed to `new URL()` for headers / image remotePatterns.
 *
 * Goals:
 *  - Fail predictably with variable-specific remediation instead of generic `Invalid URL`.
 *  - Validate scheme and format; allow http only for localhost development.
 *  - Report all invalid variables at once with actionable guidance.
 *  - Never echo credentials, query tokens, or full endpoint values in diagnostics.
 */

export const ALLOWED_PROTOCOLS = ["https:", "http:"] as const;
export const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export interface SingleValidationResult {
  varName: string;
  hostname: string | null;
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
 */
export function validateEndpointUrl(
  varName: string,
  rawValue: string | undefined | null,
  options: { required: boolean }
): SingleValidationResult {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!trimmed) {
    if (options.required) {
      return {
        varName,
        hostname: null,
        fallbackUsed: false,
        error:
          `${varName} is missing or empty. ` +
          `Set it in your .env.local or deployment environment ` +
          `(e.g., https://soroban-testnet.stellar.org for testnet, https://soroban-rpc.mainnet.stellar.org for mainnet). ` +
          `See docs/deployment/environment.md and client/.env.example. ` +
          `Do not include credentials, tokens, or query strings.`,
      };
    }
    return { varName, hostname: null, error: null, fallbackUsed: true };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      varName,
      hostname: null,
      fallbackUsed: false,
      error:
        `${varName} is malformed. ` +
        `Expected a valid URL with https:// scheme (http:// allowed only for localhost development, e.g., http://localhost:8000). ` +
        `Check your .env.local or deployment environment and remove any credentials, tokens, or query strings. ` +
        `See docs/deployment/environment.md and client/.env.example.`,
    };
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol as typeof ALLOWED_PROTOCOLS[number])) {
    return {
      varName,
      hostname: null,
      fallbackUsed: false,
      error:
        `${varName} uses an unsupported scheme "${url.protocol}". ` +
        `Supported schemes are https: (http: allowed only for localhost development). ` +
        `Set ${varName} to a valid https:// URL. See docs/deployment/environment.md.`,
    };
  }

  if (url.protocol === "http:" && !isLocalhost(url.hostname)) {
    return {
      varName,
      hostname: null,
      fallbackUsed: false,
      error:
        `${varName} uses http:// for a non-local host. ` +
        `Use https:// for remote endpoints; http:// is only allowed for localhost/127.0.0.1 development. ` +
        `Set ${varName} to a valid https:// URL. See docs/deployment/environment.md.`,
    };
  }

  if (!url.hostname) {
    return {
      varName,
      hostname: null,
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
      fallbackUsed: false,
      error:
        `${varName} must not contain embedded credentials (username/password). ` +
        `Remove credentials and use environment-native secret management instead. ` +
        `Set ${varName} to a plain https:// URL.`,
    };
  }

  // hostname is safe to expose; full URL / query / port is not echoed
  return { varName, hostname: url.hostname, error: null, fallbackUsed: false };
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
