"use client";

import { useState, useEffect } from "react";

const EXPIRY_HOURS = 96;

interface CountdownTimerProps {
  createdAt: number; // unix timestamp in seconds
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

export default function CountdownTimer({ createdAt }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    function update() {
      const expiryTime = createdAt + EXPIRY_HOURS * 3600;
      const diff = expiryTime - Math.floor(Date.now() / 1000);
      setRemaining(formatTime(diff));
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [createdAt]);

  const expiryTime = createdAt + EXPIRY_HOURS * 3600;
  const isExpired = Math.floor(Date.now() / 1000) >= expiryTime;

  return (
    <span
      className={`text-xs font-medium ${
        isExpired ? "text-red-600" : "text-secondary-700"
      }`}
    >
      {remaining}
    </span>
  );
}
