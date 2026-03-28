"use client";

import React, { useState } from "react";
import { Button, Card, CardContent, Container, Text } from "@/components/ui";
import BarterOfferForm from "@/components/BarterOfferForm";
import { useWallet } from "@/hooks/useWallet";

export default function BarterPage() {
  const { address, connected } = useWallet();
  const [showForm, setShowForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function handleSuccess() {
    setSuccessMessage("Barter offer submitted successfully!");
    setTimeout(() => setSuccessMessage(null), 5000);
  }

  return (
    <Container size="lg" className="py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Text variant="heading" className="text-2xl font-bold">
            Barter Trades
          </Text>
          <Text variant="body" muted className="mt-1">
            Propose goods-for-goods trades with other farmers.
          </Text>
        </div>
        {connected && (
          <Button variant="primary" onClick={() => setShowForm(true)}>
            New Barter Offer
          </Button>
        )}
      </div>

      {successMessage && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
          <Text variant="body" className="text-primary-700">
            {successMessage}
          </Text>
        </div>
      )}

      {!connected && (
        <Card variant="default" padding="lg">
          <CardContent className="text-center py-12">
            <Text variant="body" muted className="text-lg">
              Connect your wallet to propose or view barter trades.
            </Text>
          </CardContent>
        </Card>
      )}

      {connected && (
        <Card variant="default" padding="lg">
          <CardContent className="text-center py-12">
            <Text variant="body" muted>
              No active barter offers yet. Click &quot;New Barter Offer&quot; to
              propose a trade.
            </Text>
          </CardContent>
        </Card>
      )}

      {address && (
        <BarterOfferForm
          open={showForm}
          walletAddress={address}
          onClose={() => setShowForm(false)}
          onSuccess={handleSuccess}
        />
      )}
    </Container>
  );
}
