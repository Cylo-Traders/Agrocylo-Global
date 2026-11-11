import * as Sentry from '@sentry/node';
import { config } from './index.js';
import logger from './logger.js';

let initialized = false;

/**
 * Initializes Sentry error tracking (Issue #756). Safe to call even without
 * a DSN configured — the SDK no-ops in that case rather than throwing.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  if (!config.sentryDsn) {
    logger.warn(
      '[sentry]: SENTRY_DSN not set — error tracking disabled. Errors will only be visible in logs.',
    );
    return;
  }

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.sentryTracesSampleRate,
  });
  logger.info('[sentry]: Error tracking initialized');
}

/**
 * Reports a non-exception operational alert (a threshold crossed, a job
 * that failed without throwing at the call site) as a Sentry event, tagged
 * so alert rules can route on `alert_type` without parsing message text.
 * Falls back to a plain log line if Sentry isn't configured.
 */
export function captureAlert(
  alertType: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  logger.error(`[alert:${alertType}] ${message}`, extra);
  if (!config.sentryDsn) return;
  Sentry.captureMessage(message, {
    level: 'error',
    tags: { alert_type: alertType },
    extra,
  });
}

export { Sentry };
