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

const eventQueue: Array<{ name: EventName; properties?: EventProperties }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (!TELEMETRY_ENABLED) return;

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
  if (!TELEMETRY_ENABLED) return;
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
  if (typeof window === "undefined" || !TELEMETRY_ENABLED) return;

  window.addEventListener("beforeunload", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  trackPageView(window.location.pathname);

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    trackPageView(window.location.pathname);
  };
  window.addEventListener("popstate", () => {
    trackPageView(window.location.pathname);
  });
}
