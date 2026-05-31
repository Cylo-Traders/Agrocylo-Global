import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TransactionStatusTracker from "./TransactionStatusTracker";

// Mock custom hooks to control status state
vi.mock("@/hooks/useTransactionStatusTracker", () => ({
  useTransactionStatusTracker: vi.fn(({ initialStatus }) => ({
    status: initialStatus || "pending",
    order: {
      orderId: "ord_111",
      buyer: "GD_BUYER",
      seller: "GD_SELLER",
      amount: BigInt(150_000_000), // 15 XLM
      status: initialStatus || "pending",
      createdAt: Math.floor(Date.now() / 1000) - 3600,
    },
    isLoading: false,
    error: null,
    lastUpdated: new Date(),
    confirmationCount: 1,
    refresh: vi.fn(),
  })),
}));

vi.mock("@/hooks/useSocket", () => ({
  useSocket: vi.fn(() => ({
    isConnected: true,
  })),
}));

describe("TransactionStatusTracker Component", () => {
  it("renders pending state correctly with estimated time info", () => {
    render(<TransactionStatusTracker orderId="ord_111" initialStatus="pending" />);

    expect(screen.getByText("Transaction Status")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Est. ~5 min to next step")).toBeInTheDocument();
  });

  it("renders funded state details successfully", () => {
    render(<TransactionStatusTracker orderId="ord_111" initialStatus="funded" />);

    expect(screen.getByText("Funded")).toBeInTheDocument();
    expect(screen.getByText("Escrow has been funded successfully.")).toBeInTheDocument();
  });

  it("renders disputed status with appropriate alert badges and icons", () => {
    render(<TransactionStatusTracker orderId="ord_111" initialStatus="disputed" />);

    expect(screen.getByText("Disputed")).toBeInTheDocument();
    expect(screen.getByText("A dispute is active. Funds are held until resolved.")).toBeInTheDocument();
  });
});
