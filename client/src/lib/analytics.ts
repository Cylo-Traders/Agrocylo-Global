export type EventName =
  | "page_view"
  | "wallet_connected"
  | "wallet_disconnected"
  | "product_viewed"
  | "product_added_to_cart"
  | "product_removed_from_cart"
  | "order_created"
  | "order_confirmed"
  | "barter_offer_created"
  | "search_performed"
  | "theme_toggled"
  | "error_occurred";

export function trackEvent(name: EventName, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;

  try {
    console.log(`[Analytics] ${name}`, properties ?? {});
    if (typeof (window as any).posthog?.capture === "function") {
      (window as any).posthog.capture(name, properties);
    }
    if (typeof (window as any).mixpanel?.track === "function") {
      (window as any).mixpanel.track(name, properties);
    }
  } catch {
    /* analytics should never throw */
  }
}

export function trackPageView(path: string) {
  trackEvent("page_view", { path });
}
