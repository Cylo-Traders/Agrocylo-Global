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

// Single, documented destination for users whose profile role does not match
// the route's requiredRole. /market is deliberately not wrapped in AuthGuard
// (see client/src/app/(root)/market), so the fallback can never bounce a
// mismatched user back into a guarded route and create a redirect loop.
const ROLE_MISMATCH_FALLBACK = "/market";

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
      router.replace(ROLE_MISMATCH_FALLBACK);
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
