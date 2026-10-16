"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/context/ProfileContext";
import type { UserRole } from "@/types/user";

interface AuthGuardProps {
  children: ReactNode;
  requiredRole?: UserRole;
}

export default function AuthGuard({ children, requiredRole }: AuthGuardProps) {
  const router = useRouter();
  const { connected, restoring } = useWallet();
  const { profile, isLoaded } = useProfile();

  // Wait for both the wallet restoration and the profile fetch to settle
  // before making any redirect decision. Acting on the first render — while a
  // cached wallet is still being restored — would bounce a freshly-onboarded
  // user back to /onboarding in a loop.
  useEffect(() => {
    if (!isLoaded || restoring) return;

    if (!connected || !profile) {
      router.replace("/onboarding");
      return;
    }

    if (requiredRole && profile.role !== requiredRole) {
      router.replace(
        profile.role === "farmer" ? "/dashboard/products" : "/market",
      );
    }
  }, [connected, profile, isLoaded, restoring, requiredRole, router]);

  if (!isLoaded || restoring || !connected || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <Loader2 className="text-primary size-6 animate-spin" />
        <p className="text-muted-foreground text-sm">Checking access…</p>
      </div>
    );
  }

  if (requiredRole && profile.role !== requiredRole) {
    return null;
  }

  return <>{children}</>;
}
