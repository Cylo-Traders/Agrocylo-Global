"use client";

import { ShieldCheck, Lock, BadgeCheck } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { PageHeader } from "@/components/shared/page-header";
import EnhancedEscrowTransaction from "@/components/EnhancedEscrowTransaction";

// Demo / sandbox flow — a fixed product against which to test the
// Soroban create_order pipeline. Wire to a real product page later.
const demoProduct = {
  farmerAddress: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  // XLM SAC contract for the active network. Configure via env.
  tokenAddress: process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ?? "",
  pricePerUnit: 10.5,
  productName: "Organic Tomatoes (Sandbox)",
};

const features = [
  {
    Icon: Lock,
    title: "Funds locked",
    blurb:
      "Your XLM is held by the Soroban escrow contract, not by AgroCylo or the farmer.",
  },
  {
    Icon: BadgeCheck,
    title: "Released on confirmation",
    blurb:
      "When you confirm delivery, the contract pays the farmer minus a 3% platform fee.",
  },
  {
    Icon: ShieldCheck,
    title: "Refundable on expiry",
    blurb:
      "If the farmer doesn't deliver by your chosen deadline, you can refund the escrow.",
  },
];

export default function EscrowDemoPage() {
  return (
    <Wrapper className="pt-32 pb-20 md:pt-40">
      <PageHeader
        title="Escrow Sandbox"
        description="Try the on-chain escrow flow against a sandbox product before using it for a real order."
      />

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {features.map(({ Icon, title, blurb }) => (
          <div
            key={title}
            className="bg-card flex flex-col gap-2 rounded-2xl border p-5"
          >
            <div className="bg-primary/10 text-primary grid size-10 place-content-center rounded-full">
              <Icon className="size-5" />
            </div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-muted-foreground text-sm">{blurb}</p>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <EnhancedEscrowTransaction
          farmerAddress={demoProduct.farmerAddress}
          tokenAddress={demoProduct.tokenAddress}
          pricePerUnit={demoProduct.pricePerUnit}
          productName={demoProduct.productName}
        />
      </div>
    </Wrapper>
  );
}
