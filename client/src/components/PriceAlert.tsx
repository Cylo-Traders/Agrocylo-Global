"use client";

import { useEffect, useState } from "react";
import {
  TrendingDown,
  TrendingUp,
  Bell,
  X,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PriceAlert, PriceTrend } from "@/types/priceAlert";
import { priceAlertService } from "@/services/priceAlertService";

interface PriceAlertProps {
  alert: PriceAlert;
  onDismiss?: (id: string) => void;
  onAction?: (id: string) => void;
}

export default function PriceAlertComponent({
  alert,
  onDismiss,
  onAction,
}: PriceAlertProps) {
  const [trends, setTrends] = useState<PriceTrend[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!alert.productId) return;

    const fetchTrends = async () => {
      try {
        setLoading(true);
        const data = await priceAlertService.getPriceHistory(
          alert.productId!,
          7
        );
        setTrends(
          data.map((item) => ({
            timestamp: item.timestamp,
            price: item.price,
            averagePrice:
              data.reduce((sum, d) => sum + d.price, 0) / data.length,
          }))
        );
      } catch (error) {
        console.error("Failed to fetch price trends:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchTrends();
  }, [alert.productId]);

  const getAlertIcon = () => {
    if (alert.alertType === "above") return <TrendingUp className="size-5" />;
    if (alert.alertType === "below") return <TrendingDown className="size-5" />;
    return <AlertCircle className="size-5" />;
  };

  const getPriceChange = () => {
    if (!alert.currentPrice || !alert.priceAtCreation) return null;
    const change = alert.currentPrice - alert.priceAtCreation;
    const percentage = ((change / alert.priceAtCreation) * 100).toFixed(2);
    return { change, percentage };
  };

  const priceChange = getPriceChange();
  const isPositive = priceChange && priceChange.change > 0;

  return (
    <Card className="relative">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2">{getAlertIcon()}</div>
          <div>
            <CardTitle className="text-base">Price Alert</CardTitle>
            <CardDescription className="text-xs">
              {alert.categoryId ? "Category alert" : "Product alert"}
            </CardDescription>
          </div>
        </div>
        {onDismiss && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDismiss(alert.id)}
            className="h-auto p-1"
          >
            <X className="size-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Current Price */}
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Current Price</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">
              ${alert.currentPrice?.toFixed(2) || "N/A"}
            </span>
            {priceChange && (
              <Badge
                variant="outline"
                className={
                  isPositive
                    ? "text-green-700 border-green-200 bg-green-50"
                    : "text-red-700 border-red-200 bg-red-50"
                }
              >
                {isPositive ? "+" : ""}{priceChange.percentage}%
              </Badge>
            )}
          </div>
        </div>

        {/* Alert Threshold */}
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Alert Threshold</p>
          <p className="text-sm font-medium">
            {alert.alertType === "percentage"
              ? `${alert.percentageChange}% change`
              : `${alert.alertType} $${alert.thresholdPrice?.toFixed(2)}`}
          </p>
        </div>

        {/* Location */}
        {alert.region && (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Region</p>
            <p className="text-sm font-medium">{alert.region}</p>
          </div>
        )}

        {/* Notification Preference */}
        <div className="flex items-center gap-2">
          <Bell className="size-4 text-muted-foreground" />
          <p className="text-xs capitalize">
            <span className="text-muted-foreground">Notify via</span>{" "}
            {alert.notifyVia}
          </p>
        </div>

        {/* Action Button */}
        {onAction && (
          <Button
            onClick={() => onAction(alert.id)}
            className="w-full"
            size="sm"
          >
            View Product
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
