"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getFavoriteIds,
  getServerFavoriteIds,
  toggleFavorite,
  clearFavorites,
} from "@/services/productService";

const FAVORITE_EVENT = "favorites-change";

function subscribeToFavorites(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === "market:favorites") callback();
  };
  window.addEventListener(FAVORITE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(FAVORITE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

function emitFavoriteChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(FAVORITE_EVENT));
  }
}

export function useFavorites() {
  const favoriteIds = useSyncExternalStore(
    subscribeToFavorites,
    getFavoriteIds,
    getServerFavoriteIds,
  );

  const toggle = useCallback((productId: string) => {
    const added = toggleFavorite(productId);
    emitFavoriteChange();
    return added;
  }, []);

  const clear = useCallback(() => {
    clearFavorites();
    emitFavoriteChange();
  }, []);

  return {
    favoriteIds,
    isFavorite: (id: string) => favoriteIds.includes(id),
    toggleFavorite: toggle,
    clearFavorites: clear,
  };
}
