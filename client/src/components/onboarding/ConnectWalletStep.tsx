"use client";

import { Button } from "@/components/ui/button";
import { Wallet, CheckCircle2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

interface ConnectWalletStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export default function ConnectWalletStep({
  onNext,
  onBack,
  onSkip,
}: ConnectWalletStepProps) {
  const { address, connect, isConnecting } = useWallet();

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex p-3 rounded-full bg-primary/10 mb-4">
          <Wallet className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
        <p className="text-muted-foreground">
          You'll need a Stellar wallet to use AgroCylo. We recommend Freighter.
        </p>
      </div>

      {!address ? (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border bg-muted/50">
            <h3 className="font-semibold mb-2">What is Freighter?</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Freighter is a browser extension wallet for the Stellar network.
              It's secure, easy to use, and free.
            </p>
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Download Freighter →
            </a>
          </div>

          <Button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full"
            size="lg"
          >
            {isConnecting ? "Connecting..." : "Connect Freighter Wallet"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/20 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-semibold text-green-900 dark:text-green-100">
                Wallet Connected
              </p>
              <p className="text-sm text-green-700 dark:text-green-300 font-mono">
                {address.slice(0, 8)}...{address.slice(-6)}
              </p>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-muted/50">
            <h3 className="font-semibold mb-2">About XLM and USDC</h3>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>
                <strong>XLM (Lumens)</strong> - The native currency of Stellar.
                Fast and low-cost.
              </li>
              <li>
                <strong>USDC</strong> - A stablecoin pegged to the US Dollar.
                Stable value for pricing.
              </li>
            </ul>
          </div>
        </div>
      )}

      <div className="flex gap-3 justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <Button onClick={onNext} disabled={!address}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
