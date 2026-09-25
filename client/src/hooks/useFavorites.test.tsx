import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useFavorites } from "./useFavorites";
import {
  clearFavorites,
  getFavoriteIds,
  getServerFavoriteIds,
} from "@/services/productService";

describe("useFavorites", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearFavorites();
  });

  it("returns stable client and server snapshots", () => {
    expect(getFavoriteIds()).toBe(getFavoriteIds());
    expect(getServerFavoriteIds()).toBe(getServerFavoriteIds());
  });

  it("updates mounted consumers once when toggled or cleared", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => result.current.toggleFavorite("product-1"));
    expect(result.current.favoriteIds).toEqual(["product-1"]);

    act(() => result.current.clearFavorites());
    expect(result.current.favoriteIds).toEqual([]);
  });

  it("reflects valid cross-tab updates and ignores corrupt storage", () => {
    const { result } = renderHook(() => useFavorites());

    window.localStorage.setItem(
      "market:favorites",
      JSON.stringify(["product-2"]),
    );
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "market:favorites",
          newValue: JSON.stringify(["product-2"]),
        }),
      ),
    );
    expect(result.current.favoriteIds).toEqual(["product-2"]);

    window.localStorage.setItem("market:favorites", "not-json");
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "market:favorites",
          newValue: "not-json",
        }),
      ),
    );
    expect(result.current.favoriteIds).toEqual([]);
  });
});
