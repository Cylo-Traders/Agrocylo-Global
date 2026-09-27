import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { I18nProvider } from "@/context/I18nContext";
import NavBar from "@/components/NavBar";
import AnalyticsInit from "@/components/AnalyticsInit";
import HandoffConsumer from "@/components/HandoffConsumer";
import PendingTransactionsResolver from "@/components/PendingTransactionsResolver";
import { redirect } from "next/navigation";
import { themeBootstrapScript } from "@/theme/theme";

export const metadata: Metadata = {
  title: "Agro Production",
  description: "Agricultural production campaigns on Stellar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Issue #1020: Production build gate for agro-production routes.
  // In a real scenario, this environment variable would be set during the production build process.
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED !== 'true') {
    redirect('/');
  }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Issue #1055: resolve the theme before the first paint. The script is
          inline and synchronous on purpose; moving it into an effect or an
          external file would let the light `:root` palette paint first.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
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
      </body>
    </html>
  );
}
