"use client";

import CopyButton from "@/components/shared/copy-button";
import { Hash } from "lucide-react";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";

export function AddressBlock({
  label,
  address,
}: {
  label: string;
  address: string | null | undefined;
}) {
  if (!address) {
    return (
      <div>
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-sm">—</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="flex items-center gap-2">
        <p className="font-mono text-sm">{formatTruncatedAddress(address)}</p>
        <CopyButton
          text={address}
          className="text-muted-foreground hover:text-foreground inline-flex items-center"
          iconClassName="!size-3.5"
        />
      </div>
    </div>
  );
}

export function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <div
        className={
          highlight
            ? "mt-0.5 text-lg font-semibold"
            : "mt-0.5 text-sm font-medium"
        }
      >
        {value}
      </div>
    </div>
  );
}

export function TxRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground flex items-center gap-1">
        <Hash className="size-3" />
        {label}
      </p>
      <div className="flex items-center gap-2">
        <p className="font-mono break-all">{hash}</p>
        <CopyButton
          text={hash}
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center"
          iconClassName="!size-3.5"
        />
      </div>
    </div>
  );
}
