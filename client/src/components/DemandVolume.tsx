"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { DemandVolume as DemandVolumeType } from "@/types/demand";
import { cn } from "@/lib/utils";

interface DemandVolumeProps {
  data: DemandVolumeType;
}

function GrowthIndicator({ pct }: { pct: number }) {
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
        <TrendingUp className="size-3" />
        <span className="text-[10px] font-semibold">+{pct.toFixed(1)}%</span>
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-500 dark:text-red-400">
        <TrendingDown className="size-3" />
        <span className="text-[10px] font-semibold">{pct.toFixed(1)}%</span>
      </span>
    );
  }
  return (
    <span className="text-muted-foreground inline-flex items-center gap-0.5">
      <Minus className="size-3" />
      <span className="text-[10px]">0%</span>
    </span>
  );
}

export function DemandVolume({ data }: DemandVolumeProps) {
  const entries = Object.entries(data.category_breakdown);

  // Determine most popular category by volume
  const topCategory = entries.reduce<string | null>((best, [cat, vol]) => {
    if (!best) return cat;
    return Number(vol) > Number(data.category_breakdown[best as keyof typeof data.category_breakdown])
      ? cat
      : best;
  }, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="text-primary size-4" />
          Current Demand Volume
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Total volume + overall growth */}
        <div className="flex items-end gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-primary text-4xl font-bold tracking-tight">
              {Number(data.total_volume).toLocaleString()}
            </span>
            <span className="text-muted-foreground text-lg font-medium">
              {data.unit}
            </span>
          </div>
          {data.growth_pct !== undefined && (
            <div className="mb-1">
              <GrowthIndicator pct={data.growth_pct} />
            </div>
          )}
        </div>

        {data.growth_pct !== undefined && (
          <p className="text-muted-foreground -mt-2 text-xs">
            vs previous period
          </p>
        )}

        <Separator />

        <div className="space-y-3">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Breakdown by Category
          </p>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">No category data.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {entries.map(([category, volume]) => {
                const growth = data.category_growth?.[category as keyof typeof data.category_growth];
                const isTop = category === topCategory;
                return (
                  <div
                    key={category}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border p-2",
                      isTop
                        ? "bg-primary/5 border-primary/30"
                        : "bg-secondary/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("text-sm font-medium", isTop && "text-primary")}>
                        {category}
                      </span>
                      {isTop && (
                        <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase">
                          Top
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {Number(volume).toLocaleString()} {data.unit}
                      </Badge>
                      {growth !== undefined && <GrowthIndicator pct={growth} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
