import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CartDrawer from "./CartDrawer";

const m = vi.hoisted(() => ({
  getConfirmedCart: vi.fn(),
  removeCartItem: vi.fn().mockResolvedValue(undefined),
  refreshCart: vi.fn().mockResolvedValue(undefined),
  signAndSubmit: vi.fn(),
  buildCreateOrderTransaction: vi.fn(),
  approveToken: vi.fn().mockResolvedValue({ success: false }),
  revalidateCartStock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/context/CartContext", () => ({
  useCart: () => ({
    cart: {
      cart_id: "cart_1",
      groups: [
        {
          farmer_wallet: "FARMER_1",
          farmer_name: "Green Farm",
          currency: "USDC",
          subtotal: "10000000",
          items: [
            {
              id: "item_1",
              product_id: "p1",
              name: "Wheat",
              quantity: "10",
              unit_price: "1000000",
              unit: "kg",
            },
          ],
        },
      ],
    },
    itemCount: 1,
    cartLoading: false,
    cartError: null,
    drawerOpen: true,
    setDrawerOpen: vi.fn(),
    refreshCart: m.refreshCart,
    setQuantityForProduct: vi.fn(),
    removeCartItem: m.removeCartItem,
    hasPendingUpdates: false,
    getConfirmedCart: m.getConfirmedCart,
  }),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GBUYER",
    connected: true,
    signAndSubmit: m.signAndSubmit,
  }),
}));

vi.mock("@/services/stellar/contractService", () => ({
  buildCreateOrderTransaction: m.buildCreateOrderTransaction,
  approveToken: m.approveToken,
}));

vi.mock("@/services/orderService", () => ({
  resolveIndexedOrderId: vi.fn(),
}));

vi.mock("@/services/stellar/networkConfig", () => ({
  getNetworkConfig: () => ({ contractId: "CESCROW" }),
  isContractConfigured: () => true,
  requireTokenContractId: () => "CTOKEN",
}));

vi.mock("@/services/productService", () => ({
  revalidateCartStock: m.revalidateCartStock,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  }),
}));

const confirmedGroup = {
  farmer_wallet: "FARMER_1",
  farmer_name: "Green Farm",
  currency: "USDC",
  subtotal: "10000000",
  items: [
    {
      id: "item_1",
      product_id: "p1",
      name: "Wheat",
      quantity: "10",
      unit_price: "1000000",
      unit: "kg",
    },
  ],
};

async function startCheckout() {
  render(<CartDrawer />);
  fireEvent.click(screen.getByText("Proceed to Checkout"));
  fireEvent.change(screen.getByLabelText(/Delivery deadline/i), {
    target: { value: "2026-12-01T10:00" },
  });
  fireEvent.click(screen.getByText("Confirm & Create Escrow Orders"));
}

describe("CartDrawer checkout stock revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getConfirmedCart.mockResolvedValue({ groups: [confirmedGroup] });
    m.signAndSubmit.mockResolvedValue({ success: true, txHash: "tx-real" });
    m.buildCreateOrderTransaction.mockResolvedValue({ success: true, data: "XDR" });
  });

  it("reports changes and does not sign when stock changed", async () => {
    m.revalidateCartStock.mockResolvedValue([
      {
        productId: "p1",
        name: "Wheat",
        reason: "insufficient_stock",
        message: "Only 5 kg of Wheat left — you requested 10.",
        requestedQuantity: 10,
        availableStock: 5,
      },
    ]);

    await startCheckout();

    expect(await screen.findByText("Availability changed")).toBeInTheDocument();
    expect(
      screen.getByText(/Only 5 kg of Wheat left/i),
    ).toBeInTheDocument();
    expect(m.buildCreateOrderTransaction).not.toHaveBeenCalled();
    expect(m.signAndSubmit).not.toHaveBeenCalled();
  });

  it("proceeds to sign when revalidation is clean", async () => {
    m.revalidateCartStock.mockResolvedValue([]);

    await startCheckout();

    await waitFor(() =>
      expect(m.buildCreateOrderTransaction).toHaveBeenCalled(),
    );
    expect(m.signAndSubmit).toHaveBeenCalledWith("XDR");
  });
});