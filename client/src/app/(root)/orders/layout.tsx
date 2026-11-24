import type { Metadata } from "next";

import AuthGuard from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { siteConfig } from "@/config/site.config";

export const metadata: Metadata = {
  title: "Orders",
  description: "Track your Cylo escrow orders and delivery milestones.",
  openGraph: {
    title: "Orders",
    description: "Track your Cylo escrow orders and delivery milestones.",
    url: "/orders",
    siteName: siteConfig.brand,
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630 }],
  },
};

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary>
      <AuthGuard>{children}</AuthGuard>
    </ErrorBoundary>
  );
}
