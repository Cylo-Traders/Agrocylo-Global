type EventName =
  | "page_view"
  | "wallet_connected"
  | "wallet_disconnected"
  | "order_placed"
  | "order_created"
  | "investment_made"
  | "product_viewed"
  | "campaign_viewed"
  | "theme_toggled"
  | "error_occurred";

type EventProperties = Record<string, string | number | boolean | undefined>;

/**
 * Telemetry payload sent to NEXT_PUBLIC_TELEMETRY_URL.
 * Fields are redacted as follows:
 * - address: first 8 characters + "..." to avoid exposing full wallet addresses
 * - stack: not included (see errorTracking.ts for stack handling)
 */
export interface AnalyticsPayload {
  events: Array<{
    name: EventName;
    properties?: EventProperties;
  }>;
  url: string;
  userAgent: string;
  timestamp: string;
}

const TELEMETRY_ENABLED = process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === "true";
const CONSENT_KEY = "ap_analytics_consent";

const eventQueue: Array<{ name: EventName; properties?: EventProperties }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

function hasAnalyticsConsent() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export type AnalyticsConsentState = "unknown" | "granted" | "denied";

export function getAnalyticsConsent(): AnalyticsConsentState {
  if (typeof window === "undefined") return "unknown";
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

export function setAnalyticsConsent(consent: "granted" | "denied") {
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // Fail closed when consent cannot be persisted.
    consent = "denied";
  }
  if (consent === "denied") {
    eventQueue.length = 0;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  }
  window.dispatchEvent(new CustomEvent("agrocylo:analytics-consent", { detail: consent }));
}

function sendToTelemetryEndpoint(payload: AnalyticsPayload) {
  if (!TELEMETRY_ENABLED) return;

  const telemetryUrl = process.env.NEXT_PUBLIC_TELEMETRY_URL;
  if (!telemetryUrl) {
    console.warn(
      "[analytics] Telemetry enabled but NEXT_PUBLIC_TELEMETRY_URL is not set. Skipping."
    );
    return;
  }

  const body = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    navigator.sendBeacon(telemetryUrl, body);
  } else {
    fetch(telemetryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

function flush() {
  if (!TELEMETRY_ENABLED || !hasAnalyticsConsent()) {
    eventQueue.length = 0;
    return;
  }

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0);

  const payload: AnalyticsPayload = {
    events: batch,
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    timestamp: new Date().toISOString(),
  };

  sendToTelemetryEndpoint(payload);
}

function enqueue(name: EventName, properties?: EventProperties) {
  if (!TELEMETRY_ENABLED || !hasAnalyticsConsent()) return;
  eventQueue.push({ name, properties });
  if (!flushTimer) {
    flushTimer = setTimeout(flush, 2000);
  }
}

export function trackPageView(path: string) {
  enqueue("page_view", { path });
}

export function trackWalletConnected(address?: string) {
  enqueue("wallet_connected", address ? { address: address.slice(0, 8) } : undefined);
}

export function trackWalletDisconnected() {
  enqueue("wallet_disconnected");
}

export function trackOrderPlaced(campaignId: string, amount: string) {
  enqueue("order_placed", { campaignId, amount });
}

export function trackInvestmentMade(productId: string, amount: number) {
  enqueue("investment_made", { productId, amount: String(amount) });
}

export function trackProductViewed(productId: string) {
  enqueue("product_viewed", { productId });
}

export function trackCampaignViewed(campaignId: string) {
  enqueue("campaign_viewed", { campaignId });
}

export function trackThemeToggled(theme: "dark" | "light") {
  enqueue("theme_toggled", { theme });
}

export function trackError(errorType: string, message: string) {
  enqueue("error_occurred", { errorType, message });
}

export function initAnalytics() {
  if (typeof window === "undefined" || !TELEMETRY_ENABLED || !hasAnalyticsConsent() || initialized) return;
  initialized = true;

  window.addEventListener("beforeunload", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

}
