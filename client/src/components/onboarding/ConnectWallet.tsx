"use client";

import { Wallet, CheckCircle2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useAnalytics } from "@/hooks/useAnalytics";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface ConnectWalletProps {
  onNext: () => void;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function ConnectWallet({ onNext }: ConnectWalletProps) {
  const { address, connected, loading, connect } = useWallet();
  const { trackFunnelStep } = useAnalytics();

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Connect Your Wallet</CardTitle>
        <CardDescription>
          Connect your Stellar wallet to use Cylo. You stay in custody — no
          seed phrases handed over.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {connected && address ? (
          <>
            <div className="bg-primary/5 border-primary/20 flex items-start gap-3 rounded-2xl border p-4">
              <CheckCircle2 className="text-primary mt-0.5 size-5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Wallet connected</p>
                <p className="font-mono mt-0.5 text-xs break-all">
                  {truncateAddress(address)}
                </p>
              </div>
            </div>
            <Button
              onClick={() => {
                trackFunnelStep("onboarding_completion", "wallet_confirmed", {
                  connected: true,
                });
                onNext();
              }}
              className="w-full"
            >
              Continue
            </Button>
          </>
        ) : (
          <Button
            onClick={() => {
              trackFunnelStep("onboarding_completion", "wallet_connect_started");
              void connect();
            }}
            isLoading={loading}
            className="w-full"
          >
            <Wallet className="size-4" />
            Connect Wallet
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
