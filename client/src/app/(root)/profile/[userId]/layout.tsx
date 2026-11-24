import type { Metadata } from "next";

import { siteConfig } from "@/config/site.config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ userId: string }>;
}): Promise<Metadata> {
  const { userId } = await params;
  const title = "Farmer profile";
  const description =
    "View a Cylo farmer profile, listings, and on-chain reputation.";
  const url = `/profile/${userId}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: siteConfig.brand,
      type: "profile",
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

export default function ProfileDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
