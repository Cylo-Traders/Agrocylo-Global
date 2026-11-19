"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import type {
  AnalyticsConsentState,
  AnalyticsEvent,
  AnalyticsFunnelName,
  AnalyticsMetrics,
  AnalyticsSnapshot,
  AnalyticsProperties,
} from "@/lib/analytics";
import {
  exportAnalyticsData,
  getAnalyticsSnapshot,
  refreshAnalytics,
  setAnalyticsConsent,
  subscribeAnalytics,
  trackClick,
  trackError,
  trackFeatureAdoption,
  trackFilterUsage,
  trackFunnelStep,
  trackFormSubmission,
  trackHover,
  trackPageView,
  trackSearchQuery,
  trackThemeToggled,
  trackTransactionAttempt,
  trackWalletConnected,
  trackWalletDisconnected,
} from "@/lib/analytics";

export interface AnalyticsContextValue {
  consent: AnalyticsConsentState;
  enabled: boolean;
  events: AnalyticsEvent[];
  metrics: AnalyticsMetrics;
  snapshot: AnalyticsSnapshot;
  refresh: () => void;
  setConsent: (consent: AnalyticsConsentState) => void;
  exportJson: () => string;
  exportCsv: () => string;
  trackPageView: typeof trackPageView;
  trackClick: typeof trackClick;
  trackHover: typeof trackHover;
  trackFormSubmission: typeof trackFormSubmission;
  trackTransactionAttempt: typeof trackTransactionAttempt;
  trackSearchQuery: typeof trackSearchQuery;
  trackFilterUsage: typeof trackFilterUsage;
  trackFeatureAdoption: typeof trackFeatureAdoption;
  trackFunnelStep: (
    funnel: AnalyticsFunnelName,
    step: string,
    properties?: AnalyticsProperties,
  ) => void;
  trackWalletConnected: typeof trackWalletConnected;
  trackWalletDisconnected: typeof trackWalletDisconnected;
  trackThemeToggled: typeof trackThemeToggled;
  trackError: typeof trackError;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  // Subscribe directly to the external analytics store. `getAnalyticsSnapshot`
  // returns a cached, referentially stable object, so React only re-renders
  // when the underlying data actually changes and notifications never run
  // synchronously inside insertion effects.
  const snapshot = useSyncExternalStore(
    subscribeAnalytics,
    getAnalyticsSnapshot,
    getAnalyticsSnapshot,
  );

  const refresh = useCallback(() => {
    refreshAnalytics();
  }, []);

  const setConsent = useCallback((consent: AnalyticsConsentState) => {
    // `setAnalyticsConsent` already emits (and therefore refreshes the
    // snapshot via the subscription); no extra refresh is needed.
    setAnalyticsConsent(consent);
  }, []);

  const value = useMemo<AnalyticsContextValue>(
    () => ({
      consent: snapshot.consent,
      enabled: snapshot.enabled,
      events: snapshot.events,
      metrics: snapshot.metrics,
      snapshot,
      refresh,
      setConsent,
      exportJson: () => exportAnalyticsData("json"),
      exportCsv: () => exportAnalyticsData("csv"),
      trackPageView,
      trackClick,
      trackHover,
      trackFormSubmission,
      trackTransactionAttempt,
      trackSearchQuery,
      trackFilterUsage,
      trackFeatureAdoption,
      trackFunnelStep,
      trackWalletConnected,
      trackWalletDisconnected,
      trackThemeToggled,
      trackError,
    }),
    [refresh, setConsent, snapshot],
  );

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalyticsContext() {
  const context = useContext(AnalyticsContext);
  if (!context) {
    throw new Error("useAnalyticsContext must be used within AnalyticsProvider");
  }
  return context;
}
