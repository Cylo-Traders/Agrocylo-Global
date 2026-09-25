import * as Sentry from "@sentry/node";
import { config } from "./index.js";
import logger from "./logger.js";

// Regex patterns for PII scrubbing — wallet addresses (Stellar format) and private keys.
const WALLET_ADDRESS_PATTERN = /[G][A-Z0-9]{55}/g;
const PRIVATE_KEY_PATTERN = /S[A-Z0-9]{55}/g;

/**
 * Sensitive field patterns that should be scrubbed before transmission.
 * Matches wallet addresses (Stellar format) and private keys.
 */
export const SENSITIVE_PATTERNS = [
  WALLET_ADDRESS_PATTERN,
  PRIVATE_KEY_PATTERN,
];

let initialized = false;

/**
 * Recursively scrub sensitive fields (wallet addresses, keys, secrets,
 * tokens) from error payloads before transmission.
 */
export function scrubSensitiveData(data: unknown): unknown {
  if (typeof data === "string") {
    let scrubbed = data;
    scrubbed = scrubbed.replace(WALLET_ADDRESS_PATTERN, "[WALLET_ADDRESS_REDACTED]");
    scrubbed = scrubbed.replace(PRIVATE_KEY_PATTERN, "[PRIVATE_KEY_REDACTED]");
    return scrubbed;
  }

  if (typeof data === "object" && data !== null) {
    const result = Array.isArray(data) ? [] : {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (
        key.toLowerCase().includes("wallet") ||
        key.toLowerCase().includes("address") ||
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("token")
      ) {
        (result as Record<string, unknown>)[key] = "[REDACTED]";
      } else {
        (result as Record<string, unknown>)[key] = scrubSensitiveData(value);
      }
    }
    return result;
  }

  return data;
}

/**
 * Initializes Sentry error tracking and tracing (Issue #756). Safe to call
 * multiple times — only the first call actually initializes the SDK.
 *
 * Degradation policy: FAIL OPEN — if Sentry is unavailable (no DSN, or the SDK
 * throws on init), the application continues normally and exceptions are only
 * logged locally. Uses the v8 API surface: `expressIntegration()` for request
 * context instead of the removed `Sentry.Handlers`, plus a `beforeSend` hook
 * that scrubs PII before events leave the process.
 *
 * Must be called before any other module that might throw during
 * import/setup, so call it first thing in the process entrypoint.
 */
export function initSentry(processType?: "api" | "worker" | "watcher"): void {
  if (initialized) return;
  initialized = true;

  // Prefer the validated config value, but honor a late-set env var too so
  // tests / processes can enable Sentry without a full config reload.
  const dsn = config.sentryDsn || process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn(
      "[sentry]: SENTRY_DSN not set — error tracking disabled. Errors will only be visible in logs.",
    );
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: config.nodeEnv,
      release: process.env.npm_package_version || "unknown",
      integrations: [
        Sentry.expressIntegration(),
      ],
      // Scrub sensitive data before transmission
      beforeSend: (event) => {
        if (event.request) {
          event.request = scrubSensitiveData(event.request) as typeof event.request;
        }
        if (event.extra) {
          event.extra = scrubSensitiveData(event.extra) as typeof event.extra;
        }
        if (event.tags) {
          event.tags = scrubSensitiveData(event.tags) as typeof event.tags;
        }
        return event;
      },
      tracesSampleRate: config.sentryTracesSampleRate,
      // Attach stack traces to all messages
      attachStacktrace: true,
    });

    // Add custom tags for process type
    if (processType) {
      Sentry.setTag("process_type", processType);
    }
    Sentry.setTag("node_env", config.nodeEnv);

    logger.info("[sentry]: Error tracking initialized", {
      environment: config.nodeEnv,
      release: process.env.npm_package_version,
    });
  } catch (error) {
    logger.error("Failed to initialize Sentry", { error });
    // Fail open: application continues without error tracking
  }
}

/**
 * Reports a non-exception operational alert (a threshold crossed, a job
 * that failed without throwing a catchable error at the call site, etc.)
 * as a Sentry event, tagged so alert rules can route on `alert_type` without
 * parsing message text. Falls back to a plain log line if Sentry isn't
 * configured, so alert call sites never need their own DSN-presence check.
 */
export function captureAlert(
  alertType: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  logger.error(`[alert:${alertType}] ${message}`, extra);
  if (!config.sentryDsn) return;
  Sentry.captureMessage(message, {
    level: "error",
    tags: { alert_type: alertType },
    extra,
  });
}

export { Sentry };