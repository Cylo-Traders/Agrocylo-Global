/**
 * Production feature-gate evaluation (issue #1038).
 *
 * The gate used to live in `app/layout.tsx` and called `redirect('/')`. Because
 * `/` renders through that same root layout, a disabled production build sent
 * every request — including the `/` request it redirected to — back to `/`,
 * forever. Browsers surface that as a blank page or a redirect-loop warning,
 * and there is no content anywhere for a user to land on.
 *
 * Two properties matter and are enforced here rather than at the call site:
 *
 * 1. The gate is a pure function of the environment. No redirect, no side
 *    effects, no I/O. That makes it exhaustively testable, which is what the
 *    regression test in `featureGate.test.ts` does.
 * 2. "Enabled" means exactly the string `"true"`. Anything else — `1`, `yes`,
 *    `TRUE`, unset, empty, or absent — is *disabled*. A near-miss like `1` must
 *    not enable a production build that was not deliberately turned on.
 */

/** The only value that enables the production build. */
export const PRODUCTION_FLAG_VALUE = "true";

export type ProductionGateStatus = "enabled" | "disabled";

export type ProductionGate = {
  enabled: boolean;
  status: ProductionGateStatus;
  /**
   * Why the gate resolved the way it did. Safe to render: it names the
   * variable and the expected value, never the value of any secret.
   */
  reason: string;
  /**
   * True only for a non-production build, where the gate never applies and the
   * app always renders. Kept separate from `enabled` so a dev build with the
   * flag off is not reported as "disabled" — it is simply not gated.
   */
  isProduction: boolean;
};

/**
 * Resolve the production gate.
 *
 * @param env Environment to read. Injectable so tests never mutate `process.env`.
 * @param nodeEnv `NODE_ENV`; defaults to `process.env.NODE_ENV`.
 */
export function resolveProductionGate(
  env: Record<string, string | undefined> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): ProductionGate {
  const isProduction = nodeEnv === "production";
  const raw = env.NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED;
  const enabled = raw === PRODUCTION_FLAG_VALUE;

  if (!isProduction) {
    return {
      enabled: true,
      status: "enabled",
      reason: "non-production build: gate not applied",
      isProduction: false,
    };
  }

  if (raw === undefined) {
    return {
      enabled: false,
      status: "disabled",
      reason: `NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED is not set; expected ${PRODUCTION_FLAG_VALUE}`,
      isProduction: true,
    };
  }

  if (raw !== PRODUCTION_FLAG_VALUE) {
    return {
      enabled: false,
      status: "disabled",
      // Truncated: a malformed value could be arbitrarily long, and this string
      // is rendered in the unavailable page's DOM.
      reason: `NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED must be exactly "${PRODUCTION_FLAG_VALUE}"`,
      isProduction: true,
    };
  }

  return {
    enabled: true,
    status: "enabled",
    reason: `NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED=${PRODUCTION_FLAG_VALUE}`,
    isProduction: true,
  };
}
