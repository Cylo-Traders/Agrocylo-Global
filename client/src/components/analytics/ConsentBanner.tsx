"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAnalytics } from "@/hooks/useAnalytics";

/**
 * First-load analytics consent banner.
 *
 * Distinct from `components/onboarding/LocationConsent.tsx`, which only
 * covers geolocation sharing. This banner governs general analytics
 * tracking (`src/lib/analytics.ts`) and is the only UI that can move
 * `consentState` out of its default "unknown" state.
 *
 * Renders only while consent is "unknown" (i.e. no choice has been
 * persisted yet). Once the user grants or denies, `setConsent` persists
 * the choice via `setAnalyticsConsent`/`loadConsent` in the analytics lib
 * and the banner disappears for good (until storage is cleared).
 */
export default function ConsentBanner() {
  const { consent, setConsent } = useAnalytics();

  if (consent !== "unknown") {
    return null;
  }

  return (
    <div
      data-testid="analytics-consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 p-4"
    >
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex flex-col items-center gap-4 py-4 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            We use analytics to understand how Cylo is used and improve
            the platform. No analytics data is collected until you accept.
          </p>
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setConsent("denied")}
            >
              Decline
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              onClick={() => setConsent("granted")}
            >
              Accept
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
