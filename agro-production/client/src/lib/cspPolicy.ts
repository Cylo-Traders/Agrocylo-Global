/**
 * Content-Security-Policy construction (issues #1039, #1040).
 *
 * Extracted from the inline template in `next.config.ts` so the policy is a
 * pure, testable function rather than a string literal evaluated at config load.
 * Two problems with the previous inline header:
 *
 * 1. **Hydration (#1039).** `script-src 'self' 'wasm-unsafe-eval'` with no
 *    nonce and no hashes blocks Next.js's own inline bootstrap/RSC scripts, so
 *    the page renders and then fails to hydrate — it looks alive but is inert,
 *    which is indistinguishable from a blank client. A per-request nonce
 *    attached to the framework scripts is the supported mechanism; the
 *    alternative (hash-based CSP) cannot work here because the inline script
 *    bodies vary per render.
 *
 * 2. **Observability (#1040).** Sentry and first-party telemetry are
 *    configured via env but were never added to `connect-src`, so their
 *    requests were blocked in production. `observabilityConnectSources` parses
 *    them into validated HTTPS origins, and only when the corresponding
 *    feature is actually enabled — an unset variable must not widen the policy.
 */

export type CspOptions = {
  isProduction: boolean;
  /**
   * Per-request nonce. When present, `script-src` gains `'nonce-<value>'` and
   * `style-src` gains it too (Next.js inlines a style attribute's worth of
   * critical CSS). Omit for the static/no-nonce policy.
   */
  nonce?: string | null;
  imageSources: string[];
  connectSources: string[];
  /** Origins for Sentry / telemetry, already validated (see below). */
  observabilitySources?: string[];
};

/** Nonces are base64; this rejects anything that could break out of the header. */
export function isValidCspNonce(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[A-Za-z0-9+/\-_]+={0,2}$/.test(value) && value.length >= 16;
}

/**
 * Derive a nonce. 16 random bytes, base64 — the size Next.js documents. Uses
 * the Web Crypto API, which is available in both the Edge runtime (middleware)
 * and Node 18+, so the same helper works in both.
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

/**
 * Build the full policy.
 *
 * `'unsafe-inline'` is deliberately absent from `script-src` in every branch,
 * including the nonce branch — adding it would satisfy the browser at the cost
 * of the control the nonce exists to provide. `style-src` keeps
 * `'unsafe-inline'` because Next.js and Tailwind emit inline style attributes;
 * that is a known, accepted relaxation and does not affect script execution.
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const { isProduction, imageSources, connectSources, observabilitySources = [] } = options;
  const nonce = isValidCspNonce(options.nonce) ? options.nonce : null;

  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...(nonce ? [`'nonce-${nonce}'`] : [])].join(" ");
  const styleSrc = ["'self'", "'unsafe-inline'", ...(nonce ? [`'nonce-${nonce}'`] : [])].join(" ");

  const imgSrc = unique(["'self'", ...imageSources]).join(" ");
  const connectSrc = unique(["'self'", ...connectSources, ...observabilitySources]).join(" ");

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `connect-src ${connectSrc}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Issue #1039: without these directives a nonce-bearing policy is still
    // bypassable by an injected <base> or a form posting credentials offsite.
    ...(isProduction ? [`object-src 'none'`, `upgrade-insecure-requests`] : []),
  ].join("; ");
}

export type ObservabilityEnv = {
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NEXT_PUBLIC_TELEMETRY_ENABLED?: string;
  NEXT_PUBLIC_TELEMETRY_URL?: string;
  NODE_ENV?: string;
};

/**
 * Parse the Sentry DSN and telemetry URL into `connect-src` origins (#1040).
 *
 * The client exposes both via env, but `connect-src` listed only RPC, Horizon,
 * Freighter, API and WebSocket origins, so a configured Sentry ingest or
 * telemetry endpoint was blocked by the production CSP.
 *
 * - HTTPS is required, except `http://localhost` outside production.
 * - Only the origin is kept. `url.origin` already drops the path, the DSN's
 *   project id and any query/fragment, none of which belong in a CSP list.
 * - A DSN carrying userinfo is rejected: `connect-src` takes origins, and
 *   credentials in one would be published in every response header.
 * - `NEXT_PUBLIC_TELEMETRY_ENABLED` must be exactly `true`. When it is unset
 *   or false the telemetry URL is inert, and including it would widen the
 *   policy for a feature that is not running.
 * - Malformed input is dropped and *named* by variable, never by value: a
 *   malformed DSN may still contain a public key, and this function must not
 *   be the thing that prints it.
 */
export function observabilityConnectSources(
  env: ObservabilityEnv = process.env,
): { origins: string[]; rejected: string[] } {
  const isProduction = env.NODE_ENV === "production";
  const origins: string[] = [];
  const rejected: string[] = [];

  const accept = (value: string | undefined, label: string): void => {
    if (!value) return;
    const raw = value.trim();
    if (!raw) return;
    try {
      const url = new URL(raw);
      const isLocalhost =
        url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
      if (url.protocol !== "https:" && !(isLocalhost && !isProduction)) {
        rejected.push(label);
        return;
      }
      if (url.username || url.password) {
        rejected.push(label);
        return;
      }
      origins.push(url.origin);
    } catch {
      rejected.push(label);
    }
  };

  accept(env.NEXT_PUBLIC_SENTRY_DSN, "NEXT_PUBLIC_SENTRY_DSN");

  if (env.NEXT_PUBLIC_TELEMETRY_ENABLED === "true") {
    accept(env.NEXT_PUBLIC_TELEMETRY_URL, "NEXT_PUBLIC_TELEMETRY_URL");
  }

  return { origins: unique(origins), rejected };
}
