"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import Wrapper from "@/components/shared/wrapper";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import DisputeForm from "@/components/orders/DisputeForm";
import DisputeTracker from "@/components/orders/DisputeTracker";
import { useWallet } from "@/hooks/useWallet";
import { useEscrowContract } from "@/hooks/useEscrowContract";
import { getOrder, type Order } from "@/services/stellar/contractService";

export default function DisputePage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params?.orderId;

  const { address, connected } = useWallet();
  const { openDispute, disputeState } = useEscrowContract();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasExistingDispute, setHasExistingDispute] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      setLoading(true);
      const res = await getOrder(orderId);
      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to fetch order");
      }
      setOrder(res.data);
      setHasExistingDispute(res.data.disputeId !== undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  const handleDisputeSubmit = useCallback(
    async (reason: string, evidence: string) => {
      if (!orderId) return;
      try {
        const result = await openDispute(orderId, reason, evidence);
        if (result.success) {
          await fetchOrder();
          router.push(`/orders/${orderId}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open dispute");
      }
    },
    [orderId, openDispute, fetchOrder, router]
  );

  if (!connected) {
    return (
      <Wrapper>
        <PageHeader
          title="Dispute"
          description="Connect your wallet to open a dispute"
        />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">
              Please connect your wallet to access this page.
            </p>
          </CardContent>
        </Card>
      </Wrapper>
    );
  }

  if (loading) {
    return (
      <Wrapper>
        <PageHeader title="Dispute" description="Loading order details..." />
        <p className="text-muted-foreground">Loading...</p>
      </Wrapper>
    );
  }

  if (!order) {
    return (
      <Wrapper>
        <PageHeader title="Dispute" description="Order not found" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">
              The order you are looking for does not exist.
            </p>
            <Link href="/orders" className="mt-4 inline-block">
              <Button variant="outline">
                <ArrowLeft className="mr-2 size-4" />
                Back to Orders
              </Button>
            </Link>
          </CardContent>
        </Card>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className="mb-6">
        <Link href={`/orders/${orderId}`}>
          <Button variant="ghost" className="gap-2">
            <ArrowLeft className="size-4" />
            Back to Order
          </Button>
        </Link>
      </div>

      <PageHeader
        title="Order Dispute"
        description={`Dispute for order #${orderId}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Open Dispute</CardTitle>
              <CardDescription>
                Provide details about the issue with this order
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasExistingDispute ? (
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    This order already has an active dispute.
                  </p>
                  <Link href={`/orders/${orderId}`}>
                    <Button variant="outline">View Dispute Details</Button>
                  </Link>
                </div>
              ) : (
                <DisputeForm
                  isLoading={disputeState.loading}
                  error={error || disputeState.error || null}
                  onSubmit={handleDisputeSubmit}
                  onCancel={() => router.back()}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <DisputeTracker orderId={orderId} />
        </div>
      </div>
    </Wrapper>
  );
}
