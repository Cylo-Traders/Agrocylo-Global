"use client";

import { ShieldCheck, Lock, BadgeCheck } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { PageHeader } from "@/components/shared/page-header";
import EnhancedEscrowTransaction from "@/components/EnhancedEscrowTransaction";
import { requireNativeTokenContractId } from "@/services/stellar/networkConfig";

function getDemoProduct() {
  return {
    farmerAddress: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    tokenAddress: requireNativeTokenContractId(),
    pricePerUnit: 10.5,
    productName: "Organic Tomatoes (Sandbox)",
  };
}

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
  let product: {
    farmerAddress: string;
    tokenAddress: string;
    pricePerUnit: number;
    productName: string;
  } | null = null;
  let configError: string | null = null;
  try {
    product = getDemoProduct();
  } catch (e) {
    configError = e instanceof Error ? e.message : "Token contract not configured";
  }

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
        {product ? (
          <EnhancedEscrowTransaction
            farmerAddress={product.farmerAddress}
            tokenAddress={product.tokenAddress}
            pricePerUnit={product.pricePerUnit}
            productName={product.productName}
          />
        ) : (
          <div className="bg-card rounded-2xl border p-6 text-center text-sm text-muted-foreground">
            {configError}
          </div>
        )}
      </div>
    </Wrapper>
  );
}
