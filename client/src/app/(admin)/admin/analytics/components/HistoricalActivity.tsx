"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck } from "lucide-react";
import { buildDailySeries } from "../utils";

interface HistoricalActivityProps {
  events: Array<{ timestamp: string; name: string }>;
  consent: string;
}

export function HistoricalActivity({ events, consent }: HistoricalActivityProps) {
  const dailySeries = buildDailySeries(events);

  return (
    <section className="rounded-2xl border bg-card p-6 lg:col-span-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Historical Activity</h2>
          <p className="text-muted-foreground text-sm">
            Daily event volume for the last 7 days.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <ShieldCheck className="size-3.5" />
          {consent}
        </Badge>
      </div>
      <Separator className="my-4" />
      <div className="grid grid-cols-7 gap-2">
        {dailySeries.map((day) => {
          const max = Math.max(...dailySeries.map((item) => item.value), 1);
          const height = `${Math.max((day.value / max) * 100, 8)}%`;
          return (
            <div key={day.day} className="flex min-h-40 flex-col gap-2">
              <div className="flex flex-1 items-end">
                <div
                  className="bg-primary/80 hover:bg-primary w-full rounded-t-xl transition-all"
                  style={{ height }}
                  title={`${day.label}: ${day.value} events`}
                />
              </div>
              <div className="text-center text-[11px] text-muted-foreground">
                <div>{day.label}</div>
                <div className="font-medium text-foreground">{day.value}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
