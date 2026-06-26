"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getFavoriteIds,
  toggleFavorite,
  clearFavorites,
} from "@/services/productService";

const FAVORITE_EVENT = "favorites-change";

function subscribeToFavorites(callback: () => void): () => void {
  window.addEventListener(FAVORITE_EVENT, callback);
  return () => window.removeEventListener(FAVORITE_EVENT, callback);
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
    getFavoriteIds,
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
