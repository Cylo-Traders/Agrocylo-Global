import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CartDrawer from "./CartDrawer";

const m = vi.hoisted(() => ({
  push: vi.fn(),
  getConfirmedCart: vi.fn(),
  removeCartItem: vi.fn().mockResolvedValue(undefined),
  refreshCart: vi.fn().mockResolvedValue(undefined),
  signAndSubmit: vi.fn(),
  buildCreateOrderTransaction: vi.fn(),
  approveToken: vi.fn().mockResolvedValue({ success: false }),
  resolveIndexedOrderId: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push }),
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
              id: "item_stale",
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
  resolveIndexedOrderId: m.resolveIndexedOrderId,
}));

vi.mock("@/services/stellar/networkConfig", () => ({
  getNetworkConfig: () => ({ contractId: "CESCROW" }),
  isContractConfigured: () => true,
  requireTokenContractId: () => "CTOKEN",
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  }),
}));

function confirmedGroup(subtotal: string, itemId: string) {
  return {
    farmer_wallet: "FARMER_1",
    farmer_name: "Green Farm",
    currency: "USDC",
    subtotal,
    items: [
      {
        id: itemId,
        product_id: "p1",
        name: "Wheat",
        quantity: "1",
        unit_price: subtotal,
        unit: "kg",
      },
    ],
  };
}

async function startCheckout() {
  render(<CartDrawer />);
  fireEvent.click(screen.getByText("Proceed to Checkout"));
  fireEvent.change(screen.getByLabelText(/Delivery deadline/i), {
    target: { value: "2026-12-01T10:00" },
  });
  fireEvent.click(screen.getByText("Confirm & Create Escrow Orders"));
}

describe("CartDrawer checkout snapshot and order id resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getConfirmedCart.mockResolvedValue({ groups: [confirmedGroup("7000000", "item_snapshot")] });
    m.signAndSubmit.mockResolvedValue({ success: true, txHash: "tx-real" });
    m.buildCreateOrderTransaction.mockResolvedValue({ success: true, data: "XDR" });
    m.resolveIndexedOrderId.mockResolvedValue("4242");
  });

  it("signs and cleans up the confirmed snapshot, not the stale cart", async () => {
    await startCheckout();

    await waitFor(() => expect(m.buildCreateOrderTransaction).toHaveBeenCalled());
    expect(m.buildCreateOrderTransaction).toHaveBeenCalledWith(
      "GBUYER",
      "FARMER_1",
      "CTOKEN",
      BigInt(7000000),
      "2026-12-01T10:00",
    );
    expect(m.signAndSubmit).toHaveBeenCalledWith("XDR");
    await waitFor(() =>
      expect(m.removeCartItem).toHaveBeenCalledWith("item_snapshot"),
    );
    expect(m.removeCartItem).not.toHaveBeenCalledWith("item_stale");
  });

  it("navigates with the indexed order id when resolution succeeds", async () => {
    await startCheckout();

    expect(await screen.findByText("Order #4242 · USDC")).toBeInTheDocument();
    fireEvent.click(screen.getByText("View"));
    expect(m.push).toHaveBeenCalledWith("/orders/4242");
  });

  it("shows a recoverable pending state when no indexed id is available", async () => {
    m.resolveIndexedOrderId.mockResolvedValue(null);

    await startCheckout();

    expect(
      await screen.findByText("Order pending confirmation · USDC"),
    ).toBeInTheDocument();
    expect(screen.queryByText("View")).not.toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();

    m.resolveIndexedOrderId.mockResolvedValue("777");
    fireEvent.click(screen.getByText("Check again"));
    expect(await screen.findByText("Order #777 · USDC")).toBeInTheDocument();
  });
});
