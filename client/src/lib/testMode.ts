/**
 * Centralised demo / test-mode detection.
 *
 * When NEXT_PUBLIC_DEMO_MODE=true, services return deterministic dummy data
 * instead of hitting the real backend or Soroban RPC. This is used by
 * Playwright E2E tests and local development.
 *
 * In production this env var is unset, so services always call real endpoints.
 */
export function isTestMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
