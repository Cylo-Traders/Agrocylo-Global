"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { usePriceAlerts } from "@/hooks/usePriceAlerts";
import PriceAlert from "@/components/PriceAlert";
import type { PriceAlertCreateInput } from "@/types/priceAlert";

export default function PriceAlertManager() {
  const { alerts, loading, createAlert, deleteAlert, toggleAlert } =
    usePriceAlerts();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<PriceAlertCreateInput>({
    alertType: "below",
    notifyVia: "both",
    enabled: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await createAlert(formData);
      setFormData({
        alertType: "below",
        notifyVia: "both",
        enabled: true,
      });
      setOpen(false);
    } catch (error) {
      console.error("Failed to create alert:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (id: string, currentStatus: boolean) => {
    try {
      await toggleAlert(id, !currentStatus);
    } catch (error) {
      console.error("Failed to toggle alert:", error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Price Alerts</h2>
          <p className="text-muted-foreground text-sm">
            Get notified when prices change
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 size-4" />
              New Alert
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create Price Alert</DialogTitle>
              <DialogDescription>
                Set up alerts for price changes on products or categories
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="product-id">Product ID (optional)</Label>
                <Input
                  id="product-id"
                  placeholder="Enter product ID"
                  value={formData.productId || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, productId: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category-id">Category ID (optional)</Label>
                <Input
                  id="category-id"
                  placeholder="Enter category ID"
                  value={formData.categoryId || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, categoryId: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="alert-type">Alert Type</Label>
                <Select
                  value={formData.alertType}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      alertType: value as "above" | "below" | "percentage",
                    })
                  }
                >
                  <SelectTrigger id="alert-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="below">Below Price</SelectItem>
                    <SelectItem value="above">Above Price</SelectItem>
                    <SelectItem value="percentage">Percentage Change</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.alertType !== "percentage" && (
                <div className="space-y-2">
                  <Label htmlFor="threshold">
                    {formData.alertType === "below"
                      ? "Price Below"
                      : "Price Above"}{" "}
                    ($)
                  </Label>
                  <Input
                    id="threshold"
                    type="number"
                    placeholder="0.00"
                    step="0.01"
                    value={formData.thresholdPrice || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        thresholdPrice: parseFloat(e.target.value) || undefined,
                      })
                    }
                  />
                </div>
              )}

              {formData.alertType === "percentage" && (
                <div className="space-y-2">
                  <Label htmlFor="percentage">Percentage Change (%)</Label>
                  <Input
                    id="percentage"
                    type="number"
                    placeholder="0"
                    value={formData.percentageChange || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        percentageChange: parseInt(e.target.value) || undefined,
                      })
                    }
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="region">Region (optional)</Label>
                <Input
                  id="region"
                  placeholder="Enter region"
                  value={formData.region || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, region: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notify-via">Notify Via</Label>
                <Select
                  value={formData.notifyVia || "both"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      notifyVia: value as "email" | "push" | "both",
                    })
                  }
                >
                  <SelectTrigger id="notify-via">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="push">Push</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Create Alert
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && alerts.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center text-sm">
              No price alerts yet. Create one to get started!
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && alerts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="relative">
              <PriceAlert
                alert={alert}
                onDismiss={(id) => deleteAlert(id).catch(console.error)}
                onAction={() => {
                  handleToggle(id, !alert.enabled).catch(console.error);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
