"use client";

import gsap from "gsap";
import { ReactLenis } from "lenis/react";
import { useEffect, useRef } from "react";
import type { LenisRef } from "lenis/react";
import type { FC, ReactNode } from "react";
import NextJsToploader from "nextjs-toploader";

import AnalyticsInit from "@/components/AnalyticsInit";
import ConsentBanner from "@/components/analytics/ConsentBanner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import QueryProvider from "@/components/QueryProvider";
import WalletProviderWrapper from "@/components/WalletProviderWrapper";
import { AnalyticsProvider } from "@/context/AnalyticsContext";
import { TransactionFeedbackProvider } from "@/context/TransactionFeedbackContext";

interface GlobalProviderProps {
  children: ReactNode;
  nonce?: string;
}

/**
 * Single top-level provider stack for the app.
 *
 * Layering (outer → inner):
 *   ThemeProvider               next-themes light/dark mode
 *   ReactLenis                  smooth scroll, RAF driven by GSAP ticker
 *   QueryProvider               TanStack Query cache
 *   AnalyticsProvider           local event capture + dashboard state
 *                               (+ ConsentBanner gating that capture)
 *   TransactionFeedbackProvider transaction-state machine
 *   WalletProviderWrapper       Freighter wallet + Profile + Cart + global Navbar
 *
 * Top-level UI overlays (Toaster, route progress bar) sit alongside `children`
 * so they show on every route.
 */
const GlobalProvider: FC<GlobalProviderProps> = ({ children, nonce }) => {
  // Drive Lenis from GSAP's ticker — guarantees Lenis stays in sync with
  // any GSAP-driven animations on a single RAF.
  const lenisRef = useRef<LenisRef>(null);

  useEffect(() => {
    function update(time: number) {
      lenisRef.current?.lenis?.raf(time * 1000);
    }
    gsap.ticker.add(update);
    return () => gsap.ticker.remove(update);
  }, []);

  return (
    <ThemeProvider nonce={nonce}>
      <ReactLenis root options={{ autoRaf: false }} ref={lenisRef}>
        <QueryProvider>
          <AnalyticsProvider>
            <AnalyticsInit />
            <TransactionFeedbackProvider>
              <WalletProviderWrapper>
                <NextJsToploader
                  showSpinner={false}
                  showForHashAnchor={false}
                  showAtBottom={false}
                  color="var(--primary)"
                />
                {children}
                <ConsentBanner />
                <Toaster richColors />
              </WalletProviderWrapper>
            </TransactionFeedbackProvider>
          </AnalyticsProvider>
        </QueryProvider>
      </ReactLenis>
    </ThemeProvider>
  );
};

export { GlobalProvider };
