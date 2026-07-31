import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { ThemeProvider } from "@/context/ThemeContext";
import NavBar from "@/components/NavBar";
import AnalyticsInit from "@/components/AnalyticsInit";
import HandoffConsumer from "@/components/HandoffConsumer";

export const metadata: Metadata = {
  title: "Agro Production",
  description: "Agricultural production campaigns on Stellar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <WalletProvider>
            <AnalyticsInit />
            <HandoffConsumer />
            <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:border focus:border-border focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm">
              Skip to main content
            </a>
            <NavBar />
            <main id="main-content" className="max-w-5xl mx-auto px-4 py-8">{children}</main>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
