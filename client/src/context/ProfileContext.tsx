"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallet } from "@/hooks/useWallet";
import { getProfile, type Profile } from "@/services/profileService";
import { isAdminRole } from "@/types/wallet";

interface ProfileContextValue {
  profile: Profile | null;
  isLoaded: boolean;
  isOnboarded: boolean;
  isAdmin: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setProfile: (profile: Profile | null) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { address, connected } = useWallet();
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const walletKey = connected && address ? address : null;

  useEffect(() => {
    generationRef.current += 1;
    const gen = generationRef.current;
    // Immediately clear previous wallet's profile and errors when identity changes
    setProfileState(null);
    setError(null);
    setIsLoaded(false);

    if (!walletKey) {
      setIsLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const fetched = await getProfile(walletKey);
        if (cancelled) return;
        if (gen !== generationRef.current) return;
        // Verify profile belongs to active wallet; ignore mismatched wallet_address
        if (fetched && fetched.wallet_address !== walletKey) {
          // treat as no profile for this wallet
          setProfileState(null);
        } else {
          setProfileState(fetched);
        }
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (gen !== generationRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
        setProfileState(null);
      } finally {
        if (cancelled) return;
        if (gen === generationRef.current) setIsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletKey]);

  const refresh = useCallback(async () => {
    const currentWallet = connected && address ? address : null;
    const gen = generationRef.current;
    if (!currentWallet) {
      setProfileState(null);
      setError(null);
      setIsLoaded(true);
      return;
    }
    setError(null);
    setIsLoaded(false);
    try {
      const fetched = await getProfile(currentWallet);
      if (gen !== generationRef.current) return;
      // Ensure wallet didn't change during fetch
      const stillCurrent = connected && address ? address : null;
      if (stillCurrent !== currentWallet) return;
      if (fetched && fetched.wallet_address !== currentWallet) {
        setProfileState(null);
      } else {
        setProfileState(fetched);
      }
    } catch (err) {
      if (gen !== generationRef.current) return;
      const stillCurrent = connected && address ? address : null;
      if (stillCurrent !== currentWallet) return;
      setError(err instanceof Error ? err.message : "Failed to load profile");
      setProfileState(null);
    } finally {
      if (gen === generationRef.current) {
        const stillCurrent = connected && address ? address : null;
        if (stillCurrent === currentWallet || !currentWallet) {
          setIsLoaded(true);
        }
      }
    }
  }, [address, connected]);

  const setProfile = useCallback(
    (next: Profile | null) => {
      const currentWallet = connected && address ? address : null;
      // Keep role-derived UI tied to verified profile for active wallet
      if (next && currentWallet && next.wallet_address !== currentWallet) {
        return;
      }
      if (!currentWallet && next) {
        // no active wallet, ignore
        return;
      }
      setProfileState(next);
      setIsLoaded(true);
    },
    [address, connected],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      isLoaded,
      isOnboarded: !!profile,
      isAdmin: isAdminRole(profile?.role),
      error,
      refresh,
      setProfile,
    }),
    [profile, isLoaded, error, refresh, setProfile],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used inside <ProfileProvider>");
  }
  return ctx;
}
