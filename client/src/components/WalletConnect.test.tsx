import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WalletConnect } from "@/components/shared/WalletConnect";

// Mock Freighter API
const mockFreighter = {
  isConnected: vi.fn(),
  getPublicKey: vi.fn(),
  getNetwork: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  // @ts-ignore - mocking window.freighter
  window.freighter = mockFreighter;
});

describe("WalletConnect", () => {
  it("should render connect button when wallet is disconnected", () => {
    render(<WalletConnect />);

    expect(
      screen.getByRole("button", { name: /connect wallet/i }),
    ).toBeInTheDocument();
  });

  it("should connect to Freighter wallet on button click", async () => {
    mockFreighter.isConnected.mockResolvedValue(true);
    mockFreighter.getPublicKey.mockResolvedValue(
      "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    );
    mockFreighter.getNetwork.mockResolvedValue("TESTNET");

    render(<WalletConnect />);

    const connectBtn = screen.getByRole("button", { name: /connect wallet/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(mockFreighter.getPublicKey).toHaveBeenCalled();
    });
  });

  it("should display truncated address when connected", async () => {
    const mockAddress =
      "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
    mockFreighter.isConnected.mockResolvedValue(true);
    mockFreighter.getPublicKey.mockResolvedValue(mockAddress);
    mockFreighter.getNetwork.mockResolvedValue("TESTNET");

    render(<WalletConnect />);

    const connectBtn = screen.getByRole("button", { name: /connect wallet/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      // Should show truncated address (first 6 chars)
      expect(screen.getByText(/GDQP2K/i)).toBeInTheDocument();
    });
  });

  it("should handle wallet connection error", async () => {
    mockFreighter.isConnected.mockRejectedValue(
      new Error("Freighter not installed"),
    );

    render(<WalletConnect />);

    const connectBtn = screen.getByRole("button", { name: /connect wallet/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(screen.getByText(/failed to connect/i)).toBeInTheDocument();
    });
  });

  it("should persist wallet connection in localStorage", async () => {
    const mockAddress =
      "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
    mockFreighter.isConnected.mockResolvedValue(true);
    mockFreighter.getPublicKey.mockResolvedValue(mockAddress);
    mockFreighter.getNetwork.mockResolvedValue("TESTNET");

    render(<WalletConnect />);

    const connectBtn = screen.getByRole("button", { name: /connect wallet/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(localStorage.getItem("walletAddress")).toBe(mockAddress);
      expect(localStorage.getItem("walletNetwork")).toBe("Testnet");
    });
  });

  it("should disconnect wallet and clear localStorage", async () => {
    const mockAddress =
      "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
    localStorage.setItem("walletAddress", mockAddress);
    localStorage.setItem("walletNetwork", "Testnet");

    mockFreighter.isConnected.mockResolvedValue(true);
    mockFreighter.getPublicKey.mockResolvedValue(mockAddress);

    render(<WalletConnect />);

    // Should show disconnect button
    const disconnectBtn = await waitFor(() =>
      screen.getByRole("button", { name: /disconnect/i }),
    );

    fireEvent.click(disconnectBtn);

    await waitFor(() => {
      expect(localStorage.getItem("walletAddress")).toBeNull();
      expect(localStorage.getItem("walletNetwork")).toBeNull();
    });
  });
});
