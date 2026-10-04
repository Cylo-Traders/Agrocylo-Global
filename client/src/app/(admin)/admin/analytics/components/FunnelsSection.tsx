"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatPercent } from "../utils";

interface FunnelRow {
  name: string;
  started: number;
  completed: number;
  dropOff: number;
  steps: Array<{ step: string; count: number }>;
}

interface FunnelsSectionProps {
  funnelRows: FunnelRow[];
}

export function FunnelsSection({ funnelRows }: FunnelsSectionProps) {
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Funnels</h2>
      <p className="text-muted-foreground text-sm">
        Product discovery, purchase, barter creation, and onboarding.
      </p>
      <Separator className="my-4" />
      <div className="space-y-4">
        {funnelRows.map((row) => (
          <div key={row.name} className="rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium capitalize">
                  {row.name.replaceAll("_", " ")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {row.started} started · {row.completed} completed
                </p>
              </div>
              <Badge variant={row.dropOff > 0.5 ? "destructive" : "secondary"}>
                {formatPercent(1 - row.dropOff)}
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              {row.steps.length > 0 ? (
                row.steps.map((step) => (
                  <div key={step.step} className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground w-28 shrink-0">
                      {step.step}
                    </span>
                    <div className="bg-secondary h-2 flex-1 rounded-full">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{
                          width: `${Math.max(
                            (step.count / Math.max(row.started || 1, step.count)) * 100,
                            6,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="w-10 text-right font-medium">{step.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-xs">
                  No funnel activity yet.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
