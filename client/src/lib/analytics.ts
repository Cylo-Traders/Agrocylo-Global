"use client";

export type AnalyticsConsentState = "granted" | "denied" | "unknown";

export type AnalyticsEventName =
  | "page_view"
  | "click"
  | "hover"
  | "scroll_depth"
  | "form_submit"
  | "transaction_attempt"
  | "search_query"
  | "filter_usage"
  | "feature_adoption"
  | "funnel_step"
  | "wallet_connected"
  | "wallet_disconnected"
  | "theme_toggled"
  | "consent_changed"
  | "error_occurred";

export type AnalyticsFunnelName =
  | "product_discovery"
  | "purchase"
  | "barter_creation"
  | "onboarding_completion";

export type AnalyticsPrimitive = string | number | boolean | null | undefined;
export type AnalyticsProperties = Record<string, AnalyticsPrimitive>;

export interface AnalyticsEvent {
  id: string;
  name: AnalyticsEventName;
  timestamp: string;
  sessionId: string;
  anonymousId: string;
  path: string;
  referrer?: string;
  properties: Record<string, string | number | boolean | null>;
}

export interface AnalyticsSnapshot {
  consent: AnalyticsConsentState;
  enabled: boolean;
  updatedAt: string;
  sessionId: string;
  anonymousId: string;
  events: AnalyticsEvent[];
  metrics: AnalyticsMetrics;
}

export interface AnalyticsMetrics {
  totalEvents: number;
  pageViews: number;
  uniquePages: number;
  sessionEvents: number;
  engagementScore: number;
  conversionRate: number;
  featureUsage: Array<{ feature: string; count: number }>;
  cohorts: Array<{ cohort: string; events: number; users: number }>;
  funnels: Record<
    AnalyticsFunnelName,
    {
      started: number;
      completed: number;
      dropOffPoints: Array<{ step: string; count: number }>;
      steps: Array<{ step: string; count: number }>;
    }
  >;
}

type EventListener = () => void;

const STORAGE_KEYS = {
  events: "agrocylo.analytics.events",
  consent: "agrocylo.analytics.consent",
  sessionId: "agrocylo.analytics.session-id",
  anonymousId: "agrocylo.analytics.anonymous-id",
} as const;

const MAX_STORED_EVENTS = 1_000;
const DEFAULT_FLUSH_DELAY_MS = 2_000;
const SCROLL_THRESHOLDS = [25, 50, 75, 90] as const;

const isBrowser = typeof window !== "undefined";
const analyticsEnabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== "false";
const analyticsEndpoint =
  process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT ?? "/api/analytics";

let initialized = false;
let consentState: AnalyticsConsentState = "granted";
let sessionId = "session";
let anonymousId = "anonymous";
let currentPath = "/";
let currentReferrer = "";
let flushTimer: number | null = null;

let storedEvents: AnalyticsEvent[] = [];
const subscribers = new Set<EventListener>();
const transportQueue: AnalyticsEvent[] = [];
const trackedScrollThresholds = new Set<number>();
const trackedHoverTargets = new WeakSet<Element>();
const trackedFeatureAdoption = new Set<string>();

function generateId() {
  if (isBrowser && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `analytics_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function loadConsent(): AnalyticsConsentState {
  if (!isBrowser) return "granted";
  const stored = window.localStorage.getItem(STORAGE_KEYS.consent);
  if (stored === "granted" || stored === "denied" || stored === "unknown") {
    return stored;
  }
  return "granted";
}

function persistConsent(next: AnalyticsConsentState) {
  if (!isBrowser) return;
  window.localStorage.setItem(STORAGE_KEYS.consent, next);
}

function loadSessionId(): string {
  if (!isBrowser) return generateId();
  const cached = window.localStorage.getItem(STORAGE_KEYS.sessionId);
  if (cached) return cached;
  const next = generateId();
  window.localStorage.setItem(STORAGE_KEYS.sessionId, next);
  return next;
}

function loadAnonymousId(): string {
  if (!isBrowser) return generateId();
  const cached = window.localStorage.getItem(STORAGE_KEYS.anonymousId);
  if (cached) return cached;
  const next = generateId();
  window.localStorage.setItem(STORAGE_KEYS.anonymousId, next);
  return next;
}

function loadEvents(): AnalyticsEvent[] {
  if (!isBrowser) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.events);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AnalyticsEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((event) => Boolean(event?.id && event?.name));
  } catch {
    return [];
  }
}

function persistEvents(events: AnalyticsEvent[]) {
  if (!isBrowser) return;
  window.localStorage.setItem(STORAGE_KEYS.events, JSON.stringify(events.slice(-MAX_STORED_EVENTS)));
}

function emit() {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function scheduleFlush() {
  if (!isBrowser || flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushTransport();
  }, DEFAULT_FLUSH_DELAY_MS);
}

function flushTransport() {
  if (!isBrowser || transportQueue.length === 0) return;
  const batch = transportQueue.splice(0);
  const body = JSON.stringify({ events: batch });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(analyticsEndpoint, blob);
      return;
    }
  } catch {
    // Fall back to fetch below.
  }

  fetch(analyticsEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function enqueueTransport(event: AnalyticsEvent) {
  if (!analyticsEnabled || consentState !== "granted") return;
  transportQueue.push(event);
  scheduleFlush();
}

function sanitizePrimitive(key: string, value: AnalyticsPrimitive): string | number | boolean | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let next = value.trim();
  if (next.length > 160) {
    next = next.slice(0, 160);
  }

  const lowered = key.toLowerCase();
  if (lowered.includes("address") || lowered.includes("wallet")) {
    return anonymizeAddress(next);
  }
  if (lowered.includes("email")) {
    const [name, domain] = next.split("@");
    if (!domain) return "redacted";
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return next;
}

function sanitizeProperties(properties?: AnalyticsProperties): Record<string, string | number | boolean | null> {
  if (!properties) return {};
  return Object.entries(properties).reduce<Record<string, string | number | boolean | null>>(
    (acc, [key, value]) => {
      const sanitized = sanitizePrimitive(key, value);
      if (sanitized !== null) acc[key] = sanitized;
      return acc;
    },
    {},
  );
}

function maskString(value: string, start = 6, end = 4) {
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function anonymizeAddress(address: string) {
  return maskString(address.trim());
}

function createEvent(
  name: AnalyticsEventName,
  properties?: AnalyticsProperties,
): AnalyticsEvent {
  return {
    id: generateId(),
    name,
    timestamp: new Date().toISOString(),
    sessionId,
    anonymousId,
    path: currentPath,
    referrer: currentReferrer || undefined,
    properties: sanitizeProperties(properties),
  };
}

function storeEvent(event: AnalyticsEvent) {
  storedEvents = [...storedEvents, event].slice(-MAX_STORED_EVENTS);
  persistEvents(storedEvents);
  enqueueTransport(event);
  emit();
}

function ensureWindowTracking() {
  if (!isBrowser || initialized || !analyticsEnabled) return;
  initialized = true;
  consentState = loadConsent();
  sessionId = loadSessionId();
  anonymousId = loadAnonymousId();
  storedEvents = loadEvents();
  currentPath = window.location.pathname + window.location.search;
  currentReferrer = document.referrer;

  const handleVisibility = () => {
    if (document.visibilityState === "hidden") {
      flushTransport();
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEYS.events) {
      storedEvents = loadEvents();
      emit();
      return;
    }
    if (event.key === STORAGE_KEYS.consent) {
      consentState = loadConsent();
      emit();
    }
  };

  const handleScroll = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const maxScroll =
      document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) return;
    const percent = Math.round((scrollTop / maxScroll) * 100);
    for (const threshold of SCROLL_THRESHOLDS) {
      if (percent >= threshold && !trackedScrollThresholds.has(threshold)) {
        trackedScrollThresholds.add(threshold);
        trackScrollDepth(threshold);
      }
    }
  };

  const handleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const clickable = target?.closest(
      "button, a, [role='button'], [data-analytics-click]",
    ) as HTMLElement | null;
    if (!clickable) return;
    const text = safeText(clickable);
    trackClick({
      element: clickable.tagName.toLowerCase(),
      label: text,
      href: clickable instanceof HTMLAnchorElement ? clickable.href : undefined,
      role: clickable.getAttribute("role") ?? undefined,
      dataName: clickable.getAttribute("data-analytics-click") ?? undefined,
    });
  };

  const handleHover = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    const hoverable = target?.closest(
      "[data-analytics-hover], button, a, input, select, textarea, [role='button']",
    ) as HTMLElement | null;
    if (!hoverable || trackedHoverTargets.has(hoverable)) return;
    trackedHoverTargets.add(hoverable);
    trackHover({
      element: hoverable.tagName.toLowerCase(),
      label: safeText(hoverable),
      dataName: hoverable.getAttribute("data-analytics-hover") ?? undefined,
    });
  };

  const handleSubmit = (event: SubmitEvent) => {
    const form = event.target as HTMLFormElement | null;
    if (!form) return;
    const name =
      form.getAttribute("data-analytics-form") ||
      form.id ||
      form.name ||
      "form";
    trackFormSubmission(name, {
      action: form.action || window.location.pathname,
      fields: Array.from(new FormData(form).keys()).length,
    });
  };

  const handleChange = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!target) return;
    const filterKey =
      target.getAttribute("data-analytics-filter") ||
      target.name ||
      target.id ||
      "";
    const isSearch =
      target instanceof HTMLInputElement &&
      (target.type === "search" ||
        target.getAttribute("role") === "searchbox" ||
        filterKey.toLowerCase().includes("search"));
    if (isSearch) {
      trackSearchQuery(target.value, {
        source: target.getAttribute("data-analytics-search") || filterKey || "search-input",
      });
      return;
    }
    const looksLikeFilter =
      filterKey.toLowerCase().includes("filter") ||
      filterKey.toLowerCase().includes("category") ||
      filterKey.toLowerCase().includes("sort") ||
      target.hasAttribute("data-analytics-filter");
    if (!looksLikeFilter) return;
    const value =
      target instanceof HTMLInputElement && target.type === "checkbox"
        ? target.checked
        : target.value;
    trackFilterUsage(filterKey || "filter", value, {
      source: target.getAttribute("data-analytics-source") || undefined,
    });
  };

  const handlePopState = () => {
    trackPageView(window.location.pathname + window.location.search);
  };

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = function pushState(...args) {
    originalPushState(...args);
    handlePopState();
  };
  history.replaceState = function replaceState(...args) {
    originalReplaceState(...args);
    handlePopState();
  };

  window.addEventListener("beforeunload", flushTransport);
  window.addEventListener("pagehide", flushTransport);
  window.addEventListener("popstate", handlePopState);
  window.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("click", handleClick, true);
  window.addEventListener("pointerover", handleHover, true);
  window.addEventListener("change", handleChange, true);
  window.addEventListener("submit", handleSubmit, true);
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("storage", handleStorage);

  trackPageView(currentPath, { referrer: document.referrer || undefined });
}

export function initAnalytics() {
  ensureWindowTracking();
}

export function setAnalyticsConsent(next: AnalyticsConsentState) {
  consentState = next;
  persistConsent(next);

  if (next === "denied") {
    transportQueue.length = 0;
    storedEvents = [];
    if (isBrowser) {
      window.localStorage.removeItem(STORAGE_KEYS.events);
    }
  }

  if (next === "granted") {
    persistEvents(storedEvents);
  }

  storeEvent(
    createEvent("consent_changed", {
      consent: next,
    }),
  );
}

export function getAnalyticsConsent(): AnalyticsConsentState {
  if (!isBrowser) return consentState;
  return loadConsent();
}

export function getAnalyticsEvents() {
  if (!isBrowser) return storedEvents;
  return loadEvents();
}

export function getAnalyticsSnapshot(): AnalyticsSnapshot {
  const events = getAnalyticsEvents();
  const consent = getAnalyticsConsent();
  const metrics = buildMetrics(events);
  return {
    consent,
    enabled: analyticsEnabled,
    updatedAt: new Date().toISOString(),
    sessionId,
    anonymousId,
    events,
    metrics,
  };
}

export function subscribeAnalytics(listener: EventListener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function trackPageView(path?: string, properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  if (path) {
    currentPath = path;
  }
  storeEvent(
    createEvent("page_view", {
      path: path ?? currentPath,
      ...properties,
    }),
  );
}

export function trackClick(properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(createEvent("click", properties));
}

export function trackHover(properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(createEvent("hover", properties));
}

export function trackScrollDepth(depth: number, properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(
    createEvent("scroll_depth", {
      depth,
      ...properties,
    }),
  );
}

export function trackFormSubmission(formName: string, properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(
    createEvent("form_submit", {
      form: formName,
      ...properties,
    }),
  );
}

export function trackTransactionAttempt(
  flow: "purchase" | "barter" | "escrow",
  status: "started" | "submitted" | "confirmed" | "failed",
  properties?: AnalyticsProperties,
) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(
    createEvent("transaction_attempt", {
      flow,
      status,
      ...properties,
    }),
  );
}

export function trackSearchQuery(query: string, properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  const trimmed = query.trim().slice(0, 120);
  if (!trimmed) return;
  storeEvent(
    createEvent("search_query", {
      query: trimmed,
      ...properties,
    }),
  );
}

export function trackFilterUsage(
  filterName: string,
  value: AnalyticsPrimitive,
  properties?: AnalyticsProperties,
) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(
    createEvent("filter_usage", {
      filter: filterName,
      value: sanitizePrimitive("value", value),
      ...properties,
    }),
  );
}

export function trackFeatureAdoption(feature: string, properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  const key = `${feature}:${JSON.stringify(properties ?? {})}`;
  if (trackedFeatureAdoption.has(key)) return;
  trackedFeatureAdoption.add(key);
  storeEvent(
    createEvent("feature_adoption", {
      feature,
      ...properties,
    }),
  );
}

export function trackFunnelStep(
  funnel: AnalyticsFunnelName,
  step: string,
  properties?: AnalyticsProperties,
) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(
    createEvent("funnel_step", {
      funnel,
      step,
      ...properties,
    }),
  );
}

export function trackWalletConnected(address?: string, properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(
    createEvent("wallet_connected", {
      address: address ? anonymizeAddress(address) : undefined,
      ...properties,
    }),
  );
}

export function trackWalletDisconnected(properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(createEvent("wallet_disconnected", properties));
}

export function trackThemeToggled(theme: "dark" | "light") {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(createEvent("theme_toggled", { theme }));
}

export function trackError(errorType: string, message: string, properties?: AnalyticsProperties) {
  if (!analyticsEnabled || consentState !== "granted") return;
  storeEvent(
    createEvent("error_occurred", {
      errorType,
      message: message.slice(0, 160),
      ...properties,
    }),
  );
}

export function exportAnalyticsData(format: "json" | "csv" = "json") {
  const snapshot = getAnalyticsSnapshot();
  if (format === "json") {
    return JSON.stringify(snapshot, null, 2);
  }

  const rows = snapshot.events.map((event) => ({
    id: event.id,
    name: event.name,
    timestamp: event.timestamp,
    path: event.path,
    referrer: event.referrer ?? "",
    properties: JSON.stringify(event.properties),
  }));

  const header = ["id", "name", "timestamp", "path", "referrer", "properties"];
  const csvRows = [header.join(",")];
  for (const row of rows) {
    csvRows.push(
      header
        .map((key) => csvEscape(String(row[key as keyof typeof row] ?? "")))
        .join(","),
    );
  }
  return csvRows.join("\n");
}

function csvEscape(value: string) {
  if (/["\n,]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function safeText(element: HTMLElement) {
  const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
  return label.trim().replace(/\s+/g, " ").slice(0, 80);
}

function buildMetrics(events: AnalyticsEvent[]): AnalyticsMetrics {
  const pageViews = events.filter((event) => event.name === "page_view").length;
  const uniquePages = new Set(
    events.filter((event) => event.name === "page_view").map((event) => event.path),
  ).size;
  const sessionEvents = events.length;

  const featureUsageMap = new Map<string, number>();
  const cohortMap = new Map<string, { events: number; users: Set<string> }>();

  const funnelSteps: AnalyticsMetrics["funnels"] = {
    product_discovery: emptyFunnel(),
    purchase: emptyFunnel(),
    barter_creation: emptyFunnel(),
    onboarding_completion: emptyFunnel(),
  };

  for (const event of events) {
    const day = event.timestamp.slice(0, 10);
    const cohort = cohortMap.get(day) ?? { events: 0, users: new Set<string>() };
    cohort.events += 1;
    cohort.users.add(event.anonymousId);
    cohortMap.set(day, cohort);

    if (event.name === "feature_adoption" && typeof event.properties.feature === "string") {
      featureUsageMap.set(
        event.properties.feature,
        (featureUsageMap.get(event.properties.feature) ?? 0) + 1,
      );
    }

    if (event.name === "funnel_step" && typeof event.properties.funnel === "string") {
      const funnel = event.properties.funnel as AnalyticsFunnelName;
      const step = typeof event.properties.step === "string" ? event.properties.step : "step";
      const bucket = funnelSteps[funnel];
      if (!bucket) continue;
      const found = bucket.steps.find((entry) => entry.step === step);
      if (found) {
        found.count += 1;
      } else {
        bucket.steps.push({ step, count: 1 });
      }
      if (step === "started" || step === "viewed" || step === "opened") {
        bucket.started += 1;
      }
      if (
        step === "completed" ||
        step === "submitted" ||
        step === "confirmed" ||
        step === "saved"
      ) {
        bucket.completed += 1;
      }
    }
  }

  const featureUsage = Array.from(featureUsageMap.entries())
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count);

  const cohorts = Array.from(cohortMap.entries())
    .map(([cohort, value]) => ({
      cohort,
      events: value.events,
      users: value.users.size,
    }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));

  const totalFunnelStarts = Object.values(funnelSteps).reduce((acc, funnel) => acc + funnel.started, 0);
  const totalFunnelCompletes = Object.values(funnelSteps).reduce((acc, funnel) => acc + funnel.completed, 0);
  const conversionRate = totalFunnelStarts > 0 ? totalFunnelCompletes / totalFunnelStarts : 0;

  const interactionEvents = events.filter((event) =>
    ["click", "hover", "scroll_depth", "form_submit", "search_query", "filter_usage"].includes(event.name),
  ).length;
  const engagementScore = Math.min(
    100,
    Math.round(
      pageViews * 4 +
        interactionEvents * 2 +
        totalFunnelCompletes * 15 +
        featureUsage.reduce((acc, item) => acc + item.count, 0),
    ),
  );

  return {
    totalEvents: events.length,
    pageViews,
    uniquePages,
    sessionEvents,
    engagementScore,
    conversionRate,
    featureUsage,
    cohorts,
    funnels: funnelSteps,
  };
}

function emptyFunnel(): AnalyticsMetrics["funnels"][AnalyticsFunnelName] {
  return {
    started: 0,
    completed: 0,
    dropOffPoints: [],
    steps: [],
  };
}

export function resetAnalyticsForTests() {
  storedEvents = [];
  transportQueue.length = 0;
  trackedFeatureAdoption.clear();
  trackedScrollThresholds.clear();
}
export const trackEvent = (eventName: string, data?: Record<string, unknown>) => {
  if (typeof window !== 'undefined') {
    // Analytics implementation
    console.log(`Event tracked: ${eventName}`, data);
  }
};

export const trackPageView = (url: string) => {
  if (typeof window !== 'undefined') {
    console.log(`Page view: ${url}`);
  }
};
