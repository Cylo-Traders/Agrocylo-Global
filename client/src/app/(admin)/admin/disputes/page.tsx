"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { useSocket } from "@/hooks/useSocket";
import DisputeManager from "@/components/admin/DisputeManager";

interface Dispute {
  id?: string;
  [k: string]: unknown;
}

export default function AdminDisputeDashboard() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { on: onSocket } = useSocket();

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/disputes");
      if (!response.ok) throw new Error("Failed to fetch disputes");
      const data = await response.json();
      setDisputes(data.disputes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load disputes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDisputes();
  }, [fetchDisputes]);

  // Live re-fetch when an order status changes on-chain.
  useEffect(() => {
    const cleanup = onSocket("order:status_changed", () => {
      void fetchDisputes();
    });
    return cleanup;
  }, [onSocket, fetchDisputes]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dispute Management"
        description="Review and resolve escrow disputes raised by buyers and farmers."
      >
        <Button
          variant="outline"
          onClick={() => void fetchDisputes()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </PageHeader>

      <div className="rounded-2xl border bg-card p-6">
        {loading && disputes.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            Loading disputes…
          </p>
        ) : error ? (
          <div className="space-y-3 py-12 text-center">
            <p className="text-destructive text-sm">{error}</p>
            <Button onClick={() => void fetchDisputes()}>Try Again</Button>
          </div>
        ) : (
          <DisputeManager disputes={disputes} onRefresh={fetchDisputes} />
        )}
      </div>
    </div>
  );
}
