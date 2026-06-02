"use client";

import { Button } from "@/components/ui/button";
import { Sprout, Shield, Zap } from "lucide-react";

interface WelcomeStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Welcome to AgroCylo</h2>
        <p className="text-muted-foreground">
          Fair trade, on-chain, for every farmer
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-4 p-4 rounded-lg border">
          <div className="p-2 rounded-full bg-primary/10">
            <Sprout className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold mb-1">
              Direct Farmer-to-Buyer Connection
            </h3>
            <p className="text-sm text-muted-foreground">
              Connect directly with farmers or buyers without intermediaries.
              Get fair prices and build lasting relationships.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 p-4 rounded-lg border">
          <div className="p-2 rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold mb-1">Secure Escrow on Stellar</h3>
            <p className="text-sm text-muted-foreground">
              All transactions are secured by smart contracts on the Stellar
              blockchain. Funds are held safely until delivery is confirmed.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 p-4 rounded-lg border">
          <div className="p-2 rounded-full bg-primary/10">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold mb-1">
              Fast Payments with XLM & USDC
            </h3>
            <p className="text-sm text-muted-foreground">
              Pay with Stellar Lumens (XLM) or USDC stablecoin. Low fees,
              instant settlement, and transparent pricing.
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-4">
        <Button variant="outline" onClick={onSkip}>
          Skip Tour
        </Button>
        <Button onClick={onNext}>Get Started</Button>
      </div>
    </div>
  );
}
