"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { getQueryClient } from "@/lib/queryClient";

export default function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  useEffect(() => {
    const clearWalletScopedCache = () => queryClient.clear();
    window.addEventListener("walletIdentityChanged", clearWalletScopedCache);
    return () =>
      window.removeEventListener(
        "walletIdentityChanged",
        clearWalletScopedCache,
      );
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
