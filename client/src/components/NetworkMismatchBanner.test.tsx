import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import NetworkMismatchBanner from "./NetworkMismatchBanner";
import { WalletContext } from "@/context/WalletContext";
import type { WalletContextType } from "@/types/wallet";

function renderWith(partial: Partial<WalletContextType>) {
  return render(
    <WalletContext.Provider
      value={{ network: null, ...partial } as unknown as WalletContextType}
    >
      <NetworkMismatchBanner />
    </WalletContext.Provider>,
  );
}

describe("NetworkMismatchBanner", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders nothing when there is no mismatch", () => {
    renderWith({ networkMismatch: false });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders an alert when networkMismatch is true", () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_ENV", "mainnet");
    renderWith({ networkMismatch: true, network: "TESTNET" });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/wrong wallet network/i);
    expect(alert).toHaveTextContent(/Mainnet/);
  });

  it("hides the banner when the dismiss button is clicked", () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_ENV", "mainnet");
    renderWith({ networkMismatch: true, network: "TESTNET" });

    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /dismiss network mismatch/i }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
