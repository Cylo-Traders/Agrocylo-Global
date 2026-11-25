"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getOrderExpirySeconds } from "@/lib/order-expiry";

interface CountdownTimerProps {
  /** Unix timestamp in seconds when the order was created. */
  createdAt: number;
  /** Optional persisted delivery deadline (Unix seconds or ISO string). */
  deliveryDeadline?: number | string | null;
  className?: string;
}

function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "Expired";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export default function CountdownTimer({
  createdAt,
  deliveryDeadline,
  className,
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    function update() {
      const expiryTime = getOrderExpirySeconds({ createdAt, deliveryDeadline });
      const diff = expiryTime - Math.floor(Date.now() / 1000);
      setRemaining(formatTime(diff));
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [createdAt, deliveryDeadline]);

  const isExpired = remaining === "Expired";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        isExpired ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <Clock className="size-3.5" />
      {remaining}
    </span>
  );
}
