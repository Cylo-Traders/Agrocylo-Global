import type { Metadata } from "next";

import { siteConfig } from "@/config/site.config";
import { getProductById } from "@/services/productService";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<Metadata> {
  const { productId } = await params;
  let product: Awaited<ReturnType<typeof getProductById>> = null;

  try {
    product = await getProductById(productId);
  } catch {
    product = null;
  }

  const title = product
    ? `${product.name} — ${product.price_per_unit} ${product.currency}/${product.unit}`
    : "Product details";
  const description = product
    ? `${product.name} from ${product.location}. ${product.price_per_unit} ${product.currency} per ${product.unit}.`
    : "View product details, pricing, and supply-chain provenance on Cylo.";
  const image = product?.image_url ?? siteConfig.ogImage;
  const url = `/market/${productId}`;

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
      images: [{ url: image, alt: product?.name ?? siteConfig.ogTitle }],
    },
    twitter: {
      card: siteConfig.tCard,
      title,
      description,
      images: [image],
    },
  };
}

export default function ProductDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
