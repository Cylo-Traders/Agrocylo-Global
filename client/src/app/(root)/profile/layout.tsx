import type { Metadata } from "next";

import { siteConfig } from "@/config/site.config";

export const metadata: Metadata = {
  title: "Profile",
  description: "Manage your Cylo farmer profile and account settings.",
  openGraph: {
    title: "Profile",
    description: "Manage your Cylo farmer profile and account settings.",
    url: "/profile",
    siteName: siteConfig.brand,
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630 }],
  },
};

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
