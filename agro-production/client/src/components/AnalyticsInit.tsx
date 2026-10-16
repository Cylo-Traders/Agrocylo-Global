"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAnalyticsConsent, initAnalytics, trackPageView } from "@/lib/analytics";
import { initErrorTracking } from "@/lib/errorTracking";

export default function AnalyticsInit() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<ReturnType<typeof getAnalyticsConsent>>("unknown");

  useEffect(() => {
    setConsent(getAnalyticsConsent());
    initErrorTracking();
    const onConsent = () => setConsent(getAnalyticsConsent());
    window.addEventListener("agrocylo:analytics-consent", onConsent);
    return () => window.removeEventListener("agrocylo:analytics-consent", onConsent);
  }, []);

  useEffect(() => {
    if (consent !== "granted") return;
    initAnalytics();
    trackPageView(pathname);
  }, [consent, pathname]);

  return null;
}
