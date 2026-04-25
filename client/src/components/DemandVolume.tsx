"use client";

import { Card, CardHeader, CardTitle, CardContent, Text, Badge } from "@/components/ui";
import { DemandVolume as DemandVolumeType } from "@/types/demand";

interface DemandVolumeProps {
  data: DemandVolumeType;
}

export function DemandVolume({ data }: DemandVolumeProps) {
  return (
    <Card variant="elevated">
      <CardHeader>
        <CardTitle>Current Demand Volume</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-6">
          <Text variant="h1" className="text-primary-600 font-bold">
            {Number(data.total_volume).toLocaleString()}
          </Text>
          <Text variant="h3" muted>
            {data.unit}
          </Text>
        </div>

        <div className="space-y-3">
          <Text variant="label" muted>
            Breakdown by Category
          </Text>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(data.category_breakdown).map(([category, volume]) => (
              <div
                key={category}
                className="flex items-center justify-between p-2 rounded-lg bg-surface border border-border"
              >
                <Text variant="bodySmall" className="font-medium">
                  {category}
                </Text>
                <Badge variant="secondary">
                  {Number(volume).toLocaleString()} {data.unit}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
