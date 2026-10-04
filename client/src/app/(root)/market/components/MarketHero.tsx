"use client";

import Image from "next/image";
import Wrapper from "@/components/shared/wrapper";
import { siteConfig } from "@/config/site.config";

export function MarketHero() {
  return (
    <div className="relative">
      <div className="absolute inset-0 size-full">
        <Image
          src="/images/market-hero.avif"
          alt="Fresh produce at a farmers market"
          fill
          priority
          sizes="100vw"
          className="size-full object-cover object-center"
          unoptimized
        />
      </div>
      <div className="from-background/90 via-background/85 to-background/25 relative bg-gradient-to-r pt-40 pb-16 sm:py-44 md:py-56">
        <Wrapper>
          <h1 className="text-foreground max-w-[805px] text-3xl leading-[1.2] font-semibold sm:text-4xl md:text-5xl lg:text-[56px]">
            Discover and Trade Fresh Farm Produce on{" "}
            <span className="text-primary">{siteConfig.title}</span>.
          </h1>
          <p className="mt-3 max-w-[700px] text-base font-normal md:text-lg">
            Browse listings from farmers around the world. Every order is secured by
            Stellar escrow until you confirm delivery.
          </p>
        </Wrapper>
      </div>
    </div>
  );
}
