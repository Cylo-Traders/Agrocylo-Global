import type { Metadata } from "next";

import { siteConfig } from "@/config/site.config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): Promise<Metadata> {
  const { orderId } = await params;
  const title = `Order ${orderId}`;
  const description =
    "Track escrow status, milestones, and supply-chain provenance for this Cylo order.";
  const url = `/orders/${orderId}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: siteConfig.brand,
      type: "website",
      images: [
        { url: siteConfig.ogImage, width: 1200, height: 630, alt: title },
      ],
    },
    twitter: {
      card: siteConfig.tCard,
      title,
      description,
      images: [siteConfig.ogImage],
    },
  };
}

export default function OrderDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
