"use client";

import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";

/**
 * SSR-safe wrapper around <ConnectWalletInner>.
 *
 * The inner component reads from WalletContext / ProfileContext which are
 * client-only, so we dynamic-import with `ssr: false` and render a static
 * "Connect Wallet" placeholder during the initial paint.
 */
const ConnectWalletInner = dynamic(
  () => import("./connect-wallet-inner").then((m) => m.ConnectWalletInner),
  {
    ssr: false,
    loading: () => (
      <>
        <Button className="hidden sm:inline-flex" disabled>
          <Wallet className="size-4" />
          Connect Wallet
        </Button>
        <Button size="icon" className="inline-flex size-11 sm:hidden" disabled>
          <Wallet className="size-5" />
        </Button>
      </>
    ),
  },
);

export default function ConnectWallet() {
  return <ConnectWalletInner />;
}
