"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, ArrowLeftRight, Wallet } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import BarterOfferForm from "@/components/BarterOfferForm";
import { useWallet } from "@/hooks/useWallet";
import { useAnalytics } from "@/hooks/useAnalytics";
import { listBarterOffers } from "@/services/barterService";
import type { BarterOffer } from "@/types/barter";

export default function BarterPage() {
  const { address, connected } = useWallet();
  const [showForm, setShowForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { trackFunnelStep, trackFeatureAdoption } = useAnalytics();
  const [offers, setOffers] = useState<BarterOffer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOffers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listBarterOffers();
      setOffers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load barter offers");
      setOffers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) {
      fetchOffers();
    }
  }, [connected, fetchOffers]);

  function handleSuccess() {
    setSuccessMessage("Barter offer submitted successfully!");
    trackFunnelStep("barter_creation", "completed");
    setTimeout(() => setSuccessMessage(null), 5000);
    void fetchOffers();
  }

  return (
    <Wrapper className="pt-32 pb-20 md:pt-40">
      <PageHeader
        title="Barter Trades"
        description="Propose goods-for-goods trades with other farmers. The chain settles only the optional collateral; the goods exchange is coordinated off-chain."
      >
        {connected && (
          <Button
            onClick={() => {
              trackFeatureAdoption("barter_offer_entry");
              trackFunnelStep("barter_creation", "opened");
              setShowForm(true);
            }}
          >
            <Plus className="size-4" />
            New Barter Offer
          </Button>
        )}
      </PageHeader>

      {successMessage && (
        <div className="bg-primary/10 border-primary/30 mt-6 rounded-2xl border p-4 text-sm">
          {successMessage}
        </div>
      )}

      <div className="mt-8">
        {!connected ? (
          <EmptyState
            icon={Wallet}
            title="Connect your wallet"
            description="Sign in with Freighter to propose or view barter trades."
          />
        ) : error ? (
          <div className="bg-destructive/10 border-destructive/30 rounded-lg border p-4">
            <p className="text-destructive text-sm">{error}</p>
            <Button
              onClick={() => void fetchOffers()}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              Try Again
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-secondary/50 rounded-lg border border-border h-24 animate-pulse"
              />
            ))}
          </div>
        ) : offers.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No active barter offers yet"
            description={'Click "New Barter Offer" to propose a goods-for-goods trade.'}
            action={
              <Button
                onClick={() => {
                  trackFeatureAdoption("barter_offer_entry");
                  trackFunnelStep("barter_creation", "opened");
                  setShowForm(true);
                }}
              >
                <Plus className="size-4" />
                New Barter Offer
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="bg-secondary/30 border-border rounded-lg border p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">{offer.status}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(offer.expiry_date).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  You offer {offer.offer_items.length} item(s) for {offer.request_items.length} item(s)
                </p>
                {offer.notes && (
                  <p className="text-xs text-muted-foreground italic">{offer.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {address && (
        <BarterOfferForm
          open={showForm}
          walletAddress={address}
          onClose={() => setShowForm(false)}
          onSuccess={handleSuccess}
        />
      )}
    </Wrapper>
  );
}
