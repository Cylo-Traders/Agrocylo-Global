import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BarterOfferForm from "./BarterOfferForm";
import * as barterService from "@/services/barterService";

vi.mock("@/services/barterService");

describe("BarterOfferForm", () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();
  const walletAddress = "GTEST123456789";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks invalid submission when fields are empty", async () => {
    render(
      <BarterOfferForm
        open={true}
        walletAddress={walletAddress}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    const submitButton = screen.getByRole("button", { name: /Submit Offer/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Recipient wallet address is required/i)).toBeInTheDocument();
      expect(screen.getByText(/Add at least one item you are offering/i)).toBeInTheDocument();
      expect(screen.getByText(/Add at least one item you want to receive/i)).toBeInTheDocument();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("submits form successfully and closes modal when all fields are valid", async () => {
    vi.mocked(barterService.createBarterOffer).mockResolvedValue({
      id: "offer-123",
      proposer_wallet: walletAddress,
      recipient_wallet: "GRECIPIENT123",
      offer_items: [],
      request_items: [],
      expiry_date: new Date(Date.now() + 86400000).toISOString(),
      collateral_amount: null,
      collateral_currency: null,
      status: "pending",
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    render(
      <BarterOfferForm
        open={true}
        walletAddress={walletAddress}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Fill in recipient wallet
    const recipientInput = screen.getByPlaceholderText(/wallet address of the other party/i);
    fireEvent.change(recipientInput, { target: { value: "GRECIPIENT123" } });

    // Add offer item details
    const productInputs = screen.getAllByPlaceholderText(/e.g. Organic Tomatoes/i);
    fireEvent.change(productInputs[0], { target: { value: "Tomatoes" } });

    const quantityInputs = screen.getAllByPlaceholderText(/50/i);
    fireEvent.change(quantityInputs[0], { target: { value: "100" } });

    // Add request item
    const addItemButtons = screen.getAllByRole("button", { name: /Add item/i });
    fireEvent.click(addItemButtons[1]); // Second "Add item" for request items

    fireEvent.change(productInputs[1], { target: { value: "Carrots" } });
    fireEvent.change(quantityInputs[1], { target: { value: "50" } });

    const submitButton = screen.getByRole("button", { name: /Submit Offer/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(barterService.createBarterOffer).toHaveBeenCalled();
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("displays actionable error message when API call fails", async () => {
    const errorMessage = "Network error: API is unreachable";
    vi.mocked(barterService.createBarterOffer).mockRejectedValue(
      new Error(errorMessage)
    );

    render(
      <BarterOfferForm
        open={true}
        walletAddress={walletAddress}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Fill minimum valid form
    const recipientInput = screen.getByPlaceholderText(/wallet address of the other party/i);
    fireEvent.change(recipientInput, { target: { value: "GRECIPIENT123" } });

    const productInputs = screen.getAllByPlaceholderText(/e.g. Organic Tomatoes/i);
    fireEvent.change(productInputs[0], { target: { value: "Tomatoes" } });

    const quantityInputs = screen.getAllByPlaceholderText(/50/i);
    fireEvent.change(quantityInputs[0], { target: { value: "100" } });

    const addItemButtons = screen.getAllByRole("button", { name: /Add item/i });
    fireEvent.click(addItemButtons[1]);

    fireEvent.change(productInputs[1], { target: { value: "Carrots" } });
    fireEvent.change(quantityInputs[1], { target: { value: "50" } });

    const submitButton = screen.getByRole("button", { name: /Submit Offer/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(mockOnSuccess).not.toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
