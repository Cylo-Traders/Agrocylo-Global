"use client";

import { isAllowedProductImageUrl } from "@/lib/productImagePolicy";

interface ProductImageProps {
  name: string;
  imageUrl: string | null;
  className?: string;
}

export function ProductImage({ name, imageUrl, className = "" }: ProductImageProps) {
  const useFallback = !isAllowedProductImageUrl(imageUrl);

  return (
    <div className={`bg-neutral-100 flex items-center justify-center overflow-hidden ${className}`}>
      {useFallback ? (
        <img src="/product-placeholder.svg" alt={`Placeholder image for ${name}`} className="w-full h-full object-cover" />
      ) : (
        <img
          src={imageUrl ?? undefined}
          alt={`Image of ${name}`}
          className="w-full h-full object-cover"
          onError={(event) => {
            event.currentTarget.src = "/product-placeholder.svg";
            event.currentTarget.alt = `Placeholder image for ${name}`;
          }}
        />
      )}
    </div>
  );
}
