"use client";

import { Card, CardHeader, CardTitle, CardContent, Text, Badge } from "@/components/ui";
import { BuyerIntent } from "@/types/demand";

interface BuyerIntentsProps {
  intents: BuyerIntent[];
}

export function BuyerIntents({ intents }: BuyerIntentsProps) {
  return (
    <Card variant="elevated">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Open Buyer Intents</CardTitle>
          <Badge variant="primary">{intents.length} active</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {intents.map((intent) => (
            <div
              key={intent.id}
              className="group p-4 rounded-xl border border-border bg-surface transition-colors hover:border-primary-300"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <Text variant="h4" className="mb-0.5">
                    {intent.product_name}
                  </Text>
                  <Text variant="bodySmall" muted>
                    Buyer: {intent.buyer_name}
                  </Text>
                </div>
                <Badge variant="outline">
                  {intent.category}
                </Badge>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <Text variant="label" className="text-primary-700">
                    {intent.quantity} {intent.unit}
                  </Text>
                  <Text variant="caption" muted>
                    · {intent.location.region}
                  </Text>
                </div>
                <Text variant="caption" muted>
                  {new Date(intent.created_at).toLocaleDateString()}
                </Text>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
