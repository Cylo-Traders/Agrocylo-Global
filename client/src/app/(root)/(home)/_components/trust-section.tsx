import { IoShieldHalf } from "react-icons/io5";
import { GoLock } from "react-icons/go";
import { HiOutlineDocumentCheck } from "react-icons/hi2";

import Wrapper from "@/components/shared/wrapper";
import { siteConfig } from "@/config/site.config";

const trusts = [
  {
    title: "Soroban Smart Contracts",
    description:
      "Our Soroban escrow contracts ensure secure, transparent, and verifiable transactions between farmers and buyers.",
    icon: IoShieldHalf,
  },
  {
    title: "Escrow Protection",
    description:
      "Payments are held in escrow until delivery is confirmed, ensuring trust for both parties.",
    icon: GoLock,
  },
  {
    title: "Transparent Records",
    description:
      "All transactions are recorded on the Stellar ledger for permanent, public verification.",
    icon: HiOutlineDocumentCheck,
  },
];

export default function Testimonies() {
  return (
    <section
      id="trust"
      className="bg-secondary/50 mb-16 border-y py-10 dark:border-primary/10 dark:bg-[#0f1a10]/60 md:mb-40 md:py-32"
    >
      <Wrapper>
        <div className="grid grid-cols-1 gap-10 md:gap-20 lg:grid-cols-2 lg:gap-10">
          <div className="w-full">
            <h2 className="text-primary text-2xl font-medium sm:text-3xl md:text-4xl lg:text-[40px]">
              Built for Trust
            </h2>
            <p className="text-muted-foreground mt-4 text-base md:text-lg lg:leading-[1.5]">
              {siteConfig.title} leverages Stellar&apos;s blockchain technology
              to ensure every transaction is secure, transparent, and
              verifiable.
            </p>

            <ul role="list" className="text-muted-foreground my-8 text-sm">
              {trusts.map((list, index) => (
                <li key={index} className="mt-5 flex items-start gap-4">
                  <list.icon className="!size-6" />
                  <div className="flex flex-1 flex-col gap-1">
                    <p className="text-foreground text-base font-semibold">
                      {list.title}
                    </p>
                    <p className="text-base">{list.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-card p-6">
              <div className="text-2xl font-bold tracking-tight text-primary sm:text-3xl md:text-4xl">
                3-5s
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Settlement time on Stellar
              </p>
            </div>
            <div className="rounded-2xl bg-card p-6">
              <div className="text-2xl font-bold tracking-tight text-primary sm:text-3xl md:text-4xl">
                ~$0.00001
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Transaction cost per trade
              </p>
            </div>
            <div className="rounded-2xl bg-card p-6">
              <div className="text-2xl font-bold tracking-tight text-primary sm:text-3xl md:text-4xl">
                3%
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Flat platform fee, no hidden costs
              </p>
            </div>
            <div className="rounded-2xl bg-card p-6">
              <div className="text-2xl font-bold tracking-tight text-primary sm:text-3xl md:text-4xl">
                100%
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Of orders held in escrow until confirmed
              </p>
            </div>
          </div>
        </div>
      </Wrapper>
    </section>
  );
}
