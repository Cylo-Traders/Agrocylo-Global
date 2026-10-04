"use client";

import { Separator } from "@/components/ui/separator";

interface Feature {
  feature: string;
  count: number;
}

interface Cohort {
  cohort: string;
  users: number;
  events: number;
}

interface FeatureUsageSectionProps {
  topFeatures: Feature[];
  cohorts: Cohort[];
}

export function FeatureUsageSection({ topFeatures, cohorts }: FeatureUsageSectionProps) {
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Feature Usage</h2>
      <p className="text-muted-foreground text-sm">
        Features with the highest adoption in the current snapshot.
      </p>
      <Separator className="my-4" />
      <div className="space-y-3">
        {topFeatures.length > 0 ? (
          topFeatures.map((feature) => (
            <div key={feature.feature} className="flex items-center gap-3">
              <div className="text-muted-foreground w-36 shrink-0 text-sm">
                {feature.feature}
              </div>
              <div className="bg-secondary h-2 flex-1 rounded-full">
                <div
                  className="bg-primary h-2 rounded-full"
                  style={{
                    width: `${Math.max((feature.count / topFeatures[0].count) * 100, 8)}%`,
                  }}
                />
              </div>
              <div className="w-10 text-right text-sm font-medium">{feature.count}</div>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            No feature adoption events captured yet.
          </p>
        )}
      </div>

      <Separator className="my-4" />

      <h3 className="text-sm font-semibold">Cohorts</h3>
      <div className="mt-3 space-y-2">
        {cohorts.length > 0 ? (
          cohorts.slice(-5).reverse().map((cohort) => (
            <div key={cohort.cohort} className="flex items-center justify-between text-sm">
              <span>{cohort.cohort}</span>
              <span className="text-muted-foreground">
                {cohort.users} users · {cohort.events} events
              </span>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">No cohorts yet.</p>
        )}
      </div>
    </section>
  );
}
