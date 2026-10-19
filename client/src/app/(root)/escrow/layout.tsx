import { notFound } from "next/navigation";

import AuthGuard from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getStellarEnv } from "@/services/stellar/networkConfig";

/**
 * The escrow sandbox drives a real on-chain escrow transaction against a
 * hardcoded demo product. It must never be reachable on mainnet, and even
 * on testnet/staging it should only be used by authenticated admins.
 */
export default function EscrowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (getStellarEnv() === "mainnet") {
    notFound();
  }

  return (
    <ErrorBoundary>
      <AuthGuard requiredRole="admin">{children}</AuthGuard>
    </ErrorBoundary>
  );
}
