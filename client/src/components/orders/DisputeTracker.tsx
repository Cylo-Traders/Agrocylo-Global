"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, CheckCircle2, AlertCircle, MessageCircle } from "lucide-react";

export interface DisputeStatus {
  orderId: string;
  status: "pending" | "in_review" | "resolved" | "appealed";
  createdAt: number;
  updatedAt: number;
  resolution?: string;
  expectedResolutionTime?: number;
  messages: Array<{
    id: string;
    sender: string;
    content: string;
    timestamp: number;
  }>;
  timeline: Array<{
    event: string;
    timestamp: number;
  }>;
}

interface DisputeTrackerProps {
  orderId: string;
  onStatusChange?: (status: DisputeStatus) => void;
}

const statusColors: Record<DisputeStatus["status"], string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
  appealed: "bg-orange-100 text-orange-800",
};

const statusIcons: Record<
  DisputeStatus["status"],
  React.ComponentType<{ className?: string }>
> = {
  pending: AlertCircle,
  in_review: Clock,
  resolved: CheckCircle2,
  appealed: AlertCircle,
};

export default function DisputeTracker({
  orderId,
  onStatusChange,
}: DisputeTrackerProps) {
  const [dispute, setDispute] = useState<DisputeStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDisputeStatus = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/disputes/${orderId}`);
      if (response.ok) {
        const data: DisputeStatus = await response.json();
        setDispute(data);
        onStatusChange?.(data);
      }
    } catch (error) {
      console.error("Failed to fetch dispute status:", error);
    } finally {
      setLoading(false);
    }
  }, [orderId, onStatusChange]);

  useEffect(() => {
    void fetchDisputeStatus();
    const interval = setInterval(() => void fetchDisputeStatus(), 30000);
    return () => clearInterval(interval);
  }, [fetchDisputeStatus]);

  if (loading || !dispute) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dispute Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  const StatusIcon = statusIcons[dispute.status];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Dispute Status</CardTitle>
          <Badge className={statusColors[dispute.status]}>
            <StatusIcon className="mr-1 size-3" />
            {dispute.status.replace("_", " ").toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Timeline */}
        <div>
          <h3 className="mb-3 text-sm font-medium">Timeline</h3>
          <div className="space-y-3">
            {dispute.timeline.map((event, index) => (
              <div key={index} className="flex gap-3">
                <Clock className="mt-1 size-4 flex-shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{event.event}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(event.timestamp * 1000).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Expected Resolution */}
        {dispute.expectedResolutionTime && (
          <>
            <div>
              <p className="text-muted-foreground text-sm">
                Expected Resolution
              </p>
              <p className="text-sm font-medium">
                {new Date(dispute.expectedResolutionTime * 1000).toLocaleDateString()}
              </p>
            </div>
            <Separator />
          </>
        )}

        {/* Resolution */}
        {dispute.resolution && (
          <>
            <div>
              <h3 className="mb-2 text-sm font-medium">Resolution</h3>
              <p className="text-sm">{dispute.resolution}</p>
            </div>
            <Separator />
          </>
        )}

        {/* Message Count */}
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-muted-foreground" />
          <p className="text-sm">
            <span className="font-medium">{dispute.messages.length}</span>{" "}
            <span className="text-muted-foreground">messages</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
