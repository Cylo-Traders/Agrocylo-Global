import type { Metadata } from "next";
import type { Viewport } from "next";
import { montserratAlternates } from "@/fonts";
import { siteConfig } from "@/config/site.config";
import { GlobalProvider } from "@/components/providers/global-provider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./globals.css";
import React from 'react';
import { ThemeProvider } from '../context/ThemeContext';
import { themeScript } from '../theme/theme-script';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.title}`,
  },
  description: siteConfig.description,
  icons: siteConfig.icons,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: siteConfig.ogTitle,
    description: siteConfig.ogDescription,
    url: siteConfig.url,
    siteName: siteConfig.title,
    type: "website",
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.ogTitle,
      },
    ],
  },
  twitter: {
    card: siteConfig.tCard,
    title: siteConfig.tTitle,
    description: siteConfig.tDescription,
    images: [siteConfig.ogImage],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning className="no-transitions">
      <head>
        {/* Inline theme script to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body
        className={`${montserratAlternates.variable} flex min-h-dvh flex-col bg-background font-sans antialiased`}
      >
        <ErrorBoundary>
          <GlobalProvider>{children}</GlobalProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
