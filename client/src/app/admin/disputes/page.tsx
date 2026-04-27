"use client";

import React, { useEffect, useState, useCallback, useContext } from "react";
import { 
  Container, 
  Card, 
  CardHeader, 
  CardTitle, 
  CardContent, 
  Text, 
  Button, 
  Badge 
} from "@/components/ui";
import { WalletContext } from "@/context/WalletContext";
import { useSocket } from "@/hooks/useSocket";
import DisputeList from "@/components/admin/DisputeList";

export default function AdminDisputeDashboard() {
  const { address, connected } = useContext(WalletContext);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { on: onSocket } = useSocket();

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // In a real app, this would be an authenticated request to the backend
      const response = await fetch("/api/admin/disputes");
      if (!response.ok) {
        throw new Error("Failed to fetch disputes");
      }
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

  // Real-time updates for the dashboard
  useEffect(() => {
    const cleanup = onSocket("order:status_changed", () => {
      void fetchDisputes();
    });
    return cleanup;
  }, [onSocket, fetchDisputes]);

  return (
    <Container size="lg" className="py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Text variant="h2" as="h2" className="font-bold">Dispute Management</Text>
          <Text variant="body" muted>Review and resolve escrow disputes</Text>
        </div>
        <Button variant="outline" onClick={() => void fetchDisputes()} isLoading={loading}>
          Refresh
        </Button>
      </div>

      {!connected ? (
        <Card variant="elevated" padding="lg">
          <CardContent className="text-center py-12">
            <Text variant="h3" as="h3" className="mb-4">Admin Access Required</Text>
            <Text variant="body" muted>Please connect your admin wallet to proceed.</Text>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card variant="elevated" padding="md">
            <CardContent>
              {loading && disputes.length === 0 ? (
                <Text variant="body" muted className="text-center py-12">Loading disputes...</Text>
              ) : error ? (
                <div className="text-center py-12">
                  <Text variant="body" className="text-error mb-4">{error}</Text>
                  <Button variant="primary" onClick={() => void fetchDisputes()}>Try Again</Button>
                </div>
              ) : disputes.length === 0 ? (
                <Text variant="body" muted className="text-center py-12">No active disputes found.</Text>
              ) : (
                <DisputeList disputes={disputes} onRefresh={fetchDisputes} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Container>
  );
}
