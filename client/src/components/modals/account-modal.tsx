"use client";

import Link from "next/link";
import { useMemo } from "react";
import { minidenticon } from "minidenticons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { HiMiniArrowUpRight } from "react-icons/hi2";
import { IoIosPower } from "react-icons/io";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import CopyButton from "@/components/shared/copy-button";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";

function Identicon({ seed, className }: { seed: string; className?: string }) {
  const src = useMemo(() => {
    const svg = minidenticon(seed, 75, 50);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [seed]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} />;
}

/**
 * Network → Stellar Expert URL prefix.
 * Stellar Expert is the canonical block explorer; Horizon also has its own UI
 * but it's less polished for end users.
 */
function explorerForNetwork(network: string | null, address: string): string {
  const isMainnet =
    network === "Public Global Stellar Network ; September 2015";
  return isMainnet
    ? `https://stellar.expert/explorer/public/account/${address}`
    : `https://stellar.expert/explorer/testnet/account/${address}`;
}

function shortNetwork(network: string | null): string {
  if (!network) return "—";
  if (network.startsWith("Public")) return "mainnet";
  if (network.startsWith("Test")) return "testnet";
  return network;
}

export default function AccountModal() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const { address, balance, network, disconnect } = useWallet();
  const { profile } = useProfile();

  const rawName = profile?.display_name ?? "Anonymous";
  const displayName = rawName.split(" ")[0];

  const handleDisconnect = () => {
    try {
      setOpen(false);
      disconnect();
      router.push("/");
    } catch (error) {
      console.error("Disconnect failed:", error);
      toast.error(error instanceof Error ? error.message : "Disconnect failed");
    }
  };

  const explorerUrl = address ? explorerForNetwork(network, address) : "#";
  const balanceDisplay = balance ? `${Number(balance).toFixed(4)} XLM` : "—";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-11 items-center gap-2 rounded-full border px-3 py-2 hover:bg-accent"
        >
          <div className="grid size-10 place-content-center rounded-full border">
            <div className="bg-secondary size-8 overflow-hidden rounded-full">
              <Identicon
                seed={address ?? ""}
                className="!size-full rounded-full object-cover"
              />
            </div>
          </div>

          <div className="hidden flex-col sm:flex">
            <span className="text-sm font-medium">{displayName}</span>
            <span className="text-muted-foreground text-xs font-normal">
              {address ? formatTruncatedAddress(address) : "Connecting…"}
            </span>
          </div>

          <ChevronDown
            className={cn("size-4 transition duration-75 sm:ml-2", {
              "-rotate-180": open,
            })}
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={isMobile ? "center" : "end"}
        className="mr-6 mt-2 sm:mr-0 md:w-[380px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="grid size-12 place-content-center rounded-full border">
              <div className="bg-secondary size-10 overflow-hidden rounded-full">
                <Identicon
                  seed={address ?? ""}
                  className="!size-full rounded-full object-cover"
                />
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{displayName}</span>
              <span className="text-muted-foreground text-xs">
                {address ? formatTruncatedAddress(address) : "Connecting…"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {address && (
              <>
                <CopyButton
                  className={buttonVariants({
                    className: "!rounded-sm",
                    size: "icon",
                    variant: "secondary",
                  })}
                  iconClassName="!size-4"
                  text={address}
                />
                <Link
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="icon"
                    variant="secondary"
                    className="!rounded-sm"
                    title="View on Stellar Expert"
                  >
                    <HiMiniArrowUpRight className="!size-5" />
                    <span className="sr-only">View on Stellar Expert</span>
                  </Button>
                </Link>
              </>
            )}
            <Button
              size="icon"
              variant="secondary"
              onClick={handleDisconnect}
              title="Disconnect"
              className="!bg-destructive/5 !text-destructive !rounded-sm"
            >
              <IoIosPower className="!size-5" />
              <span className="sr-only">Disconnect</span>
            </Button>
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Balance */}
        <div className="flex select-none flex-col items-center gap-1 py-5 text-center">
          <span className="text-muted-foreground text-[11px] font-medium">
            WALLET BALANCE
          </span>
          <p className="text-2xl font-bold">{balanceDisplay}</p>
          {address && (
            <span className="text-muted-foreground mt-1 font-mono text-[10px]">
              {formatTruncatedAddress(address)}
            </span>
          )}
        </div>

        <DropdownMenuSeparator />

        {/* Network badge */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-muted-foreground text-sm">Network</span>
          <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-medium capitalize">
            {shortNetwork(network)}
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { AccountModal };
