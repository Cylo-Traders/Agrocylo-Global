import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateOrderForm } from "./CreateOrderForm";

// Mock wallet context
const mockSignTransaction = vi.fn();
vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({
    connected: true,
    address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    signTransaction: mockSignTransaction,
  }),
}));

// Mock API client
vi.mock("@/lib/apiHelper", () => ({
  apiPost: vi.fn(),
}));

describe("CreateOrderForm - Checkout Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render form with all required fields", () => {
    render(<CreateOrderForm />);

    expect(screen.getByLabelText(/farmer address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/e.g. 50kg organic tomatoes/i),
    ).toBeInTheDocument();
  });

  it("should calculate platform fee correctly", () => {
    render(<CreateOrderForm />);

    const amountInput = screen.getByLabelText(/amount/i);
    fireEvent.change(amountInput, { target: { value: "100" } });

    // 3% platform fee
    expect(screen.getByText(/platform fee \(3%\)/i)).toBeInTheDocument();
    expect(screen.getByText("3.00")).toBeInTheDocument();
    expect(screen.getByText("97.00")).toBeInTheDocument(); // Farmer receives
  });

  it("should validate farmer address format", async () => {
    render(<CreateOrderForm />);

    const farmerInput = screen.getByLabelText(/farmer address/i);
    const submitBtn = screen.getByRole("button", {
      name: /confirm & create order/i,
    });

    // Invalid address
    fireEvent.change(farmerInput, { target: { value: "invalid-address" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/invalid stellar address/i)).toBeInTheDocument();
    });
  });

  it("should validate amount is greater than zero", async () => {
    render(<CreateOrderForm />);

    const amountInput = screen.getByLabelText(/amount/i);
    const submitBtn = screen.getByRole("button", {
      name: /confirm & create order/i,
    });

    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/amount must be greater than 0/i),
      ).toBeInTheDocument();
    });
  });

  it("should handle successful order creation", async () => {
    mockSignTransaction.mockResolvedValue({
      signedTxXdr: "signed-transaction-xdr",
    });

    render(<CreateOrderForm />);

    const farmerInput = screen.getByLabelText(/farmer address/i);
    const amountInput = screen.getByLabelText(/amount/i);
    const descriptionInput = screen.getByPlaceholderText(
      /e.g. 50kg organic tomatoes/i,
    );
    const submitBtn = screen.getByRole("button", {
      name: /confirm & create order/i,
    });

    fireEvent.change(farmerInput, {
      target: {
        value: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      },
    });
    fireEvent.change(amountInput, { target: { value: "100" } });
    fireEvent.change(descriptionInput, {
      target: { value: "50kg Fresh Tomatoes" },
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignTransaction).toHaveBeenCalled();
    });
  });

  it("should disable submit button when wallet is not connected", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      address: null,
      signTransaction: vi.fn(),
    });

    render(<CreateOrderForm />);

    const submitBtn = screen.getByRole("button", {
      name: /confirm & create order/i,
    });
    expect(submitBtn).toBeDisabled();
  });
});
