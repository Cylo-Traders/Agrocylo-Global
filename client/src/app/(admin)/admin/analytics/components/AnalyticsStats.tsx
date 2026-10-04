"use client";

import { Sparkles, BarChart3, LineChart, Users } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { formatPercent } from "../utils";

interface AnalyticsStatsProps {
  metrics: {
    engagementScore: number;
    conversionRate: number;
    pageViews: number;
    uniquePages: number;
    totalEvents: number;
    sessionEvents: number;
  };
}

export function AnalyticsStats({ metrics }: AnalyticsStatsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Engagement Score"
        value={metrics.engagementScore}
        change="Composite of views, interactions, and funnel activity"
        icon={Sparkles}
      />
      <StatCard
        label="Conversion Rate"
        value={formatPercent(metrics.conversionRate)}
        change="Completion rate across tracked funnels"
        icon={BarChart3}
      />
      <StatCard
        label="Page Views"
        value={metrics.pageViews}
        change={`${metrics.uniquePages} unique pages`}
        icon={LineChart}
      />
      <StatCard
        label="Tracked Events"
        value={metrics.totalEvents}
        change={`${metrics.sessionEvents} event records`}
        icon={Users}
      />
    </div>
  );
}
