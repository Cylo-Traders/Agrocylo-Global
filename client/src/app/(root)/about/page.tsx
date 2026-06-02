import Image from "next/image";
import Link from "next/link";
import { Shield, Globe, Users } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site.config";

export const metadata = {
  title: "About Us",
};

const milestones = [
  {
    year: "2024",
    title: "Concept Born",
    description:
      "AgroCylo was conceptualized to bridge the gap between farmers and global buyers using blockchain technology.",
  },
  {
    year: "2024",
    title: "Built on Stellar",
    description:
      "We chose Stellar for its sub-cent fees, 5-second finality, and Soroban smart contracts — perfect for cross-border agricultural settlement.",
  },
  {
    year: "2025",
    title: "Marketplace Launch",
    description:
      "AgroCylo marketplace goes live, enabling farmers to list products and buyers to purchase using XLM and USDC.",
  },
  {
    year: "2025",
    title: "Escrow Integration",
    description:
      "Soroban escrow contract deployed — funds locked until delivery confirmed, with dispute resolution and 96-hour expiry safety net.",
  },
];

const values = [
  {
    icon: Shield,
    title: "Trust First",
    description:
      "Every transaction is secured by on-chain Soroban escrow. No middlemen, no fraud — just transparent commerce.",
  },
  {
    icon: Globe,
    title: "Global Access",
    description:
      "Farmers in any country can access global buyers. Stellar's payment rails remove banking and FX barriers.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description:
      "Built for farmers and buyers by a team that understands agricultural commerce from the ground up.",
  },
];

export default function AboutPage() {
  return (
    <div className="pt-28 pb-16">
      <section className="mb-20 md:mb-32">
        <Wrapper>
          <div className="mx-auto max-w-3xl text-center">
            <span className="bg-primary/10 text-primary mb-4 inline-block rounded-full px-4 py-1.5 text-sm font-medium">
              Our Story
            </span>
            <h1 className="text-foreground text-3xl leading-tight font-semibold sm:text-4xl md:text-5xl lg:text-6xl">
              Rebuilding Agriculture with{" "}
              <span className="text-primary">Blockchain Trust</span>
            </h1>
            <p className="text-muted-foreground mt-6 text-base leading-relaxed sm:text-lg md:leading-[1.7]">
              {siteConfig.title} is a decentralized agro-marketplace built on
              Stellar that connects verified farmers directly to buyers —
              eliminating middlemen, reducing costs, and ensuring trust through
              Soroban smart contract escrow.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Button asChild size="lg">
                <Link href="/market">Explore Marketplace</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/onboarding">Get Started</Link>
              </Button>
            </div>
          </div>
        </Wrapper>
      </section>

      <section className="mb-20 md:mb-32">
        <Wrapper>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-foreground mb-4 text-2xl font-semibold sm:text-3xl md:text-4xl">
                Our Mission
              </h2>
              <p className="text-muted-foreground mb-6 text-base leading-relaxed md:text-lg">
                We believe every farmer deserves fair compensation for their
                work, and every buyer deserves quality produce they can trust.
                Our mission is to make agricultural trade transparent,
                efficient, and accessible to everyone — regardless of geography
                or banking status.
              </p>
              <p className="text-muted-foreground text-base leading-relaxed md:text-lg">
                By leveraging Stellar&apos;s high-throughput payment network and
                Soroban smart contracts, AgroCylo processes transactions with
                sub-cent fees and 5-second finality, enabling micro-payments
                that make sense for small-scale farmers everywhere.
              </p>
            </div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-[40px]">
              <Image
                src="/images/home-hero.avif"
                alt="Farmers working"
                fill
                className="object-cover"
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
            </div>
          </div>
        </Wrapper>
      </section>

      <section className="mb-20 md:mb-32">
        <Wrapper>
          <div className="mb-12 text-center">
            <h2 className="text-foreground text-2xl font-semibold sm:text-3xl md:text-4xl">
              What We Stand For
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {values.map((value) => (
              <div
                key={value.title}
                className="bg-card rounded-[32px] border p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="bg-primary/10 mb-4 flex size-12 items-center justify-center rounded-2xl">
                  <value.icon className="text-primary size-6" />
                </div>
                <h3 className="mb-3 text-lg font-semibold">{value.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {value.description}
                </p>
              </div>
            ))}
          </div>
        </Wrapper>
      </section>

      <section className="mb-20 md:mb-32">
        <Wrapper>
          <div className="mb-12">
            <h2 className="text-foreground text-2xl font-semibold sm:text-3xl md:text-4xl">
              Our Journey
            </h2>
          </div>
          <div className="relative space-y-0">
            {milestones.map((milestone, index) => (
              <div key={index} className="flex gap-6">
                <div className="flex flex-col items-center">
                  <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                    {milestone.year.slice(2)}
                  </div>
                  {index < milestones.length - 1 && (
                    <div
                      className="bg-border mt-1 w-px flex-1"
                      style={{ minHeight: "3rem" }}
                    />
                  )}
                </div>
                <div className="pb-10">
                  <span className="text-primary text-xs font-semibold tracking-wider uppercase">
                    {milestone.year}
                  </span>
                  <h3 className="mt-1 text-lg font-semibold">
                    {milestone.title}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    {milestone.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Wrapper>
      </section>

      <section className="mb-20 md:mb-32">
        <Wrapper>
          <div className="bg-canvas-dark dark:border-primary/20 rounded-[40px] px-8 py-16 text-white sm:px-12 md:px-16 dark:border dark:bg-[#0d1f0e]">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-semibold sm:text-3xl md:text-4xl">
                Platform at a Glance
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4">
              {[
                { label: "Platform Fee", value: "3%" },
                { label: "Order Expiry", value: "96h" },
                { label: "Supported Tokens", value: "2" },
                { label: "Built on", value: "Stellar" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl bg-white/5 p-4 text-center sm:p-6">
                  <p className="text-primary text-3xl font-bold sm:text-4xl">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-sm text-white/70">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </Wrapper>
      </section>

      <section>
        <Wrapper className="text-center">
          <h2 className="text-foreground text-2xl font-semibold sm:text-3xl">
            Ready to join the revolution?
          </h2>
          <p className="text-muted-foreground mt-4 text-base">
            Connect your Freighter wallet and start trading fresh produce
            today.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/market">Browse Marketplace</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/onboarding">Become a Seller</Link>
            </Button>
          </div>
        </Wrapper>
      </section>
    </div>
  );
}
