import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { I18nProvider } from "@/context/I18nContext";
import NavBar from "@/components/NavBar";
import AnalyticsInit from "@/components/AnalyticsInit";
import HandoffConsumer from "@/components/HandoffConsumer";
import PendingTransactionsResolver from "@/components/PendingTransactionsResolver";
import { resolveProductionGate } from "@/lib/productionGate";
import ProductionUnavailable from "@/components/ProductionUnavailable";

export const metadata: Metadata = {
  title: "Agro Production",
  description: "Agricultural production campaigns on Stellar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Issue #1038: this layout used to `redirect('/')` when the production flag
  // was not exactly "true". `/` renders through this same layout, so every
  // request — including the one being redirected to — was sent back to `/`,
  // producing a redirect loop and the reported blank client.
  //
  // The gate now renders an explicit unavailable page instead of redirecting.
  // There is no redirect to loop through, so the response is finite and
  // user-visible in every state. The decision itself is a pure function in
  // `lib/productionGate.ts`, covered by `lib/productionGate.test.ts`.
  const gate = resolveProductionGate();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {gate.enabled ? (
          <I18nProvider>
            <ThemeProvider>
              <WalletProvider>
                <AnalyticsInit />
                <HandoffConsumer />
                <PendingTransactionsResolver />
                <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:border focus:border-border focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm">
                  Skip to main content
                </a>
                <NavBar />
                <main id="main-content" className="max-w-5xl mx-auto px-4 py-8">{children}</main>
              </WalletProvider>
            </ThemeProvider>
          </I18nProvider>
        ) : (
          // Deliberately outside the providers: an unavailable build has no
          // wallet to connect, no telemetry to emit, and no handoff to consume.
          <ProductionUnavailable reason={gate.reason} />
        )}
      </body>
    </html>
  );
}
