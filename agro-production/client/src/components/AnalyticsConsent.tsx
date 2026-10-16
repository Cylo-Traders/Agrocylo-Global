"use client";

import { useEffect, useState } from "react";
import { getAnalyticsConsent, setAnalyticsConsent } from "@/lib/analytics";
import { useI18n } from "@/context/I18nContext";

export default function AnalyticsConsent() {
  const { t } = useI18n();
  const [choice, setChoice] = useState<ReturnType<typeof getAnalyticsConsent>>("unknown");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setChoice(getAnalyticsConsent());
    const update = () => setChoice(getAnalyticsConsent());
    window.addEventListener("agrocylo:analytics-consent", update);
    return () => window.removeEventListener("agrocylo:analytics-consent", update);
  }, []);

  function choose(value: "granted" | "denied") {
    setAnalyticsConsent(value);
    setChoice(getAnalyticsConsent());
    setEditing(false);
  }

  if (choice !== "unknown" && !editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="fixed bottom-4 left-4 z-40 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground shadow"
      >
        {t("privacy.change", "Analytics preferences")}
      </button>
    );
  }

  return (
    <section
      aria-label={t("privacy.title", "Analytics preferences")}
      aria-describedby="analytics-consent-description"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between"
    >
      <p id="analytics-consent-description" className="text-sm text-foreground">
        {t("privacy.description", "Allow anonymous analytics to help improve Agro Production? You can change this choice any time.")}
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => choose("granted")}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t("privacy.accept", "Accept")}
        </button>
        <button
          type="button"
          onClick={() => choose("denied")}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
        >
          {t("privacy.decline", "Decline")}
        </button>
      </div>
    </section>
  );
}
