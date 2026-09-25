import Image from "next/image";

import Wrapper from "@/components/shared/wrapper";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function WorkWith() {
  return (
    <div className="bg-primary mb-16 py-6 sm:h-[124px] sm:py-0 md:mb-40">
      <Wrapper className="flex h-full flex-wrap items-center justify-between gap-4 sm:gap-8">
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <Avatar className="size-11 border-2 border-[#FCCD29]">
              <AvatarFallback>JJ</AvatarFallback>
            </Avatar>
            <Avatar className="-ml-4 size-11 border-2 border-[#FCCD29]">
              <AvatarFallback>DN</AvatarFallback>
            </Avatar>
            <Avatar className="-ml-4 size-11 border-2 border-[#FCCD29]">
              <AvatarFallback>OM</AvatarFallback>
            </Avatar>
            <Avatar className="-ml-4 size-11 border-2 border-[#FCCD29]">
              <AvatarFallback>HD</AvatarFallback>
            </Avatar>
          </div>
          <div className="flex flex-col gap-1 text-white">
            <p className="text-base leading-none font-semibold lg:text-lg">
              10k+ Farmers
            </p>
            <p className="text-sm leading-none font-semibold md:text-base">
              Connected to Consumers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-white">
          <div className="flex items-center gap-2">
            <Image
              src="/assets/stellar-light.svg"
              alt="Stellar"
              width={24}
              height={24}
              priority
              quality={100}
            />
            <span className="text-base font-semibold tracking-wide">
              Stellar
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Image
              src="/assets/freighter.png"
              alt="Freighter"
              width={24}
              height={24}
              priority
              quality={100}
              className="rounded-md"
            />
            <span className="text-base font-semibold tracking-wide">
              Freighter
            </span>
          </div>
        </div>
      </Wrapper>
    </div>
  );
}
