import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BuyerIntentResponse from "./BuyerIntentResponse";
import { WalletContext } from "@/context/WalletContext";
import type { WalletContextType } from "@/types/wallet";
import type { BuyerIntent } from "@/types/demand";

// Mock services to isolate UI state
vi.mock("@/services/intentResponseService", () => ({
  getResponsesForIntent: vi.fn(() => Promise.resolve([])),
  saveProposal: vi.fn(() => Promise.resolve({ id: "resp_123", status: "pending" })),
  updateProposal: vi.fn(() => Promise.resolve({ id: "resp_123", status: "pending" })),
  cancelProposal: vi.fn(() => Promise.resolve({ id: "resp_123", status: "cancelled" })),
  acceptProposal: vi.fn(() => Promise.resolve({ id: "resp_123", status: "accepted" })),
}));

const mockWallet = {
  address: "GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2",
  connected: true,
  network: "TESTNET",
};

const mockIntent: BuyerIntent = {
  id: "intent_999",
  buyer_name: "Ade Farmer",
  product_name: "Cassava Tubers",
  category: "Tubers",
  quantity: "50",
  unit: "kg",
  location: {
    region: "Oyo State",
    coordinates: [7.3775, 3.947],
  },
  created_at: new Date().toISOString(),
  budget_range: "₦30,000 - ₦40,000",
  delivery_preference: "Pickup",
};

describe("BuyerIntentResponse Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <BuyerIntentResponse intent={mockIntent} isOpen={false} onClose={vi.fn()} />
      </WalletContext.Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders intent details and form elements when open", async () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <BuyerIntentResponse intent={mockIntent} isOpen={true} onClose={vi.fn()} />
      </WalletContext.Provider>
    );

    expect(screen.getByText("Respond to Ade Farmer's Intent")).toBeInTheDocument();
    expect(screen.getByText("Cassava Tubers")).toBeInTheDocument();
    expect(screen.getByText("50 kg")).toBeInTheDocument();
    expect(screen.getByLabelText(/Proposed Price per Unit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Propose Quantity/i)).toBeInTheDocument();
  });

  it("handles input updates correctly", () => {
    render(
      <WalletContext.Provider value={mockWallet as unknown as WalletContextType}>
        <BuyerIntentResponse intent={mockIntent} isOpen={true} onClose={vi.fn()} />
      </WalletContext.Provider>
    );

    const priceInput = screen.getByLabelText(/Proposed Price per Unit/i) as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "12.75" } });
    expect(priceInput.value).toBe("12.75");

    const qtyInput = screen.getByLabelText(/Propose Quantity/i) as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: "60" } });
    expect(qtyInput.value).toBe("60");
  });
});
