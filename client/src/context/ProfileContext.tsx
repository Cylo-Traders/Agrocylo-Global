"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useWallet } from "@/hooks/useWallet";
import { getProfile, type Profile } from "@/services/profileService";

interface ProfileContextValue {
  profile: Profile | null;
  isLoaded: boolean;
  isOnboarded: boolean;
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

  const refresh = useCallback(async () => {
    if (!connected || !address) {
      setProfileState(null);
      setIsLoaded(true);
      return;
    }
    setError(null);
    try {
      const fetched = await getProfile(address);
      setProfileState(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
      setProfileState(null);
    } finally {
      setIsLoaded(true);
    }
  }, [address, connected]);

  useEffect(() => {
    setIsLoaded(false);
    void refresh();
  }, [refresh]);

  const setProfile = useCallback((next: Profile | null) => {
    setProfileState(next);
    setIsLoaded(true);
  }, []);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      isLoaded,
      isOnboarded: !!profile,
      error,
      refresh,
      setProfile,
    }),
    [profile, isLoaded, error, refresh, setProfile],
  );

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used inside <ProfileProvider>");
  }
  return ctx;
}
