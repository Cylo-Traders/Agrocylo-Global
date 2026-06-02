"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";
import { Button } from "@/components/ui/button";

interface AdminGuardProps {
  children: ReactNode;
}

export default function AdminGuard({ children }: AdminGuardProps) {
  const router = useRouter();
  const { connected } = useWallet();
  const { profile, isLoaded, isAdmin } = useProfile();

  useEffect(() => {
    if (!isLoaded) return;

    if (!connected || !profile) {
      router.replace("/onboarding");
    }
  }, [connected, profile, isLoaded, router]);

  if (!isLoaded || !connected || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <Loader2 className="text-primary size-6 animate-spin" />
        <p className="text-muted-foreground text-sm">Checking access…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="text-destructive size-10" />
        <div className="max-w-md space-y-2">
          <h1 className="text-xl font-semibold">Admin access required</h1>
          <p className="text-muted-foreground text-sm">
            Your account does not have permission to view admin pages. If you
            believe this is a mistake, contact platform support.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/">Return to marketplace</Link>
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
