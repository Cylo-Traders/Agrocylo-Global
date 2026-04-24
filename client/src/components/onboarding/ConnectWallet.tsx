"use client";

import { useWallet } from "@/hooks/useWallet";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface ConnectWalletProps {
  onNext: () => void;
}

export default function ConnectWallet({ onNext }: ConnectWalletProps) {
  const { address, connected, connect } = useWallet();

  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto text-center">
      <h2 className="text-2xl font-bold text-foreground mb-2">
        Connect Your Wallet
      </h2>
      <p className="text-muted text-sm mb-6">
        Connect your Stellar wallet to get started with AgroCylo.
      </p>

      {connected ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-primary-50 p-4">
            <p className="text-sm text-primary-700 font-medium">Connected</p>
            <p className="text-xs text-primary-600 font-mono mt-1 truncate">
              {address}
            </p>
          </div>
          <Button variant="primary" fullWidth onClick={onNext}>
            Continue
          </Button>
        </div>
      ) : (
        <Button variant="primary" fullWidth onClick={connect}>
          Connect Freighter Wallet
        </Button>
      )}
    </Card>
  );
}
