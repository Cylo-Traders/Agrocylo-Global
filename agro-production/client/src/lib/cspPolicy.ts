/**
 * Content-Security-Policy construction (issue #1039).
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
 * `buildContentSecurityPolicy` also accepts pre-validated
 * `observabilitySources`, which `next.config.ts` supplies; #1040 adds the
 * parsing that produces them.
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
 * Placeholder until #1040 lands the observability origins. Returning nothing
 * keeps `connect-src` at its pre-#1040 width.
 */
export function observabilityConnectSources(
  _env: ObservabilityEnv = process.env,
): { origins: string[]; rejected: string[] } {
  return { origins: [], rejected: [] };
}
