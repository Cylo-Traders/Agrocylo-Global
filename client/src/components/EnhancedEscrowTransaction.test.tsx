import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import EnhancedEscrowTransaction from "./EnhancedEscrowTransaction";
import { WalletContext } from "@/context/WalletContext";
import type { WalletContextType } from "@/types/wallet";

vi.mock("@/services/stellar/contractService", () => ({
  createOrder: vi.fn(() => Promise.resolve({ success: true, data: "unsignedXDR" })),
}));
vi.mock("@/lib/signTransaction", () => ({
  signAndSubmitTransaction: vi.fn(() => Promise.resolve({ success: true, txHash: "mockTxHash" })),
}));
vi.mock("@/services/notification", () => ({
  notifyTransactionSubmitted: vi.fn(),
  notifyTransactionConfirmed: vi.fn(),
  notifyTransactionFailed: vi.fn(),
  notifyTransactionConfirming: vi.fn(),
}));

const mockWallet = {
  address: "GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2",
  connected: true,
  network: "TESTNET",
};

describe("EnhancedEscrowTransaction Component", () => {
  const defaultProps = {
    farmerAddress: "FARMER_ADDR",
    tokenAddress: "TOKEN_ADDR",
    pricePerUnit: 10.5,
    productName: "Organic Mangoes",
    unit: "bags",
    minQuantity: 2,
    maxQuantity: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders premium header, price display, and input labels correctly", () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <EnhancedEscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    expect(screen.getByText("Escrow for Organic Mangoes")).toBeInTheDocument();
    expect(screen.getByText("10.50 XLM per bags")).toBeInTheDocument();
    expect(screen.getByLabelText("Purchase Quantity (bags)")).toBeInTheDocument();
  });

  it("correctly handles quantity stepper buttons (+/-) with boundaries", () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <EnhancedEscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    const input = screen.getByLabelText("Purchase Quantity (bags)") as HTMLInputElement;
    expect(input.value).toBe("1"); // Initial value

    // Stepper + increment
    const plusBtn = screen.getByRole("button", { name: /increase quantity/i });
    fireEvent.click(plusBtn);
    expect(input.value).toBe("2");

    // Click - decrement should stay at min boundary (minQuantity is 2)
    const minusBtn = screen.getByRole("button", { name: /decrease quantity/i });
    fireEvent.click(minusBtn);
    expect(input.value).toBe("2");
  });

  it("automatically calculates platforms fee (3%) and net payout in breakdown summary", () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <EnhancedEscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    const input = screen.getByLabelText("Purchase Quantity (bags)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "10" } });

    // 10 * 10.5 = 105.00 XLM
    expect(screen.getByText("105.00 XLM")).toBeInTheDocument();
    // Payout should show 105 * 0.97 = 101.85 XLM
    expect(screen.getByText("101.85 XLM")).toBeInTheDocument();
  });

  it("shows date presets buttons and updates input date value dynamically", async () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <EnhancedEscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    const input = screen.getByLabelText("Delivery Deadline") as HTMLInputElement;
    expect(input.value).toBe("");

    const presetBtn = screen.getByText("7 Days Preset");
    fireEvent.click(presetBtn);

    expect(input.value).not.toBe("");
  });

  it("triggers validation errors on invalid values", async () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <EnhancedEscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    const input = screen.getByLabelText("Purchase Quantity (bags)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1000" } }); // Exceeds max 100
    fireEvent.blur(input);

    expect(await screen.findByText(/Maximum allowed quantity is 100 bags/i)).toBeInTheDocument();
  });

  it("launches confirmation dialogue before transaction execution", async () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <EnhancedEscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    const qty = screen.getByLabelText("Purchase Quantity (bags)") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "5" } });

    const deadline = screen.getByLabelText("Delivery Deadline") as HTMLInputElement;
    // Set valid future deadline
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const dateStr = futureDate.toISOString().slice(0, 16);
    fireEvent.change(deadline, { target: { value: dateStr } });

    const submitBtn = screen.getByRole("button", { name: "Create Escrow Order" });
    fireEvent.click(submitBtn);

    // Verify confirmation modal exists
    expect(screen.getByText("Confirm On-Chain Escrow Terms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & Submit" })).toBeInTheDocument();
  });
});
