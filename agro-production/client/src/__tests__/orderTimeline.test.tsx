import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { OrderTimeline, OrderDetailsPanel } from "../components/OrderTimeline";
import type { Order } from "../types";

const mockPendingOrder: Order = {
  id: "order123",
  onChainId: "onchain123",
  campaignId: "campaign456",
  buyerAddress: "GBUYER123",
  amount: "100",
  status: "PENDING",
  ledger: 12345,
  txHash: "txhash123",
  createdAt: "2024-01-15T10:00:00Z",
  updatedAt: "2024-01-15T10:00:00Z",
};

const mockConfirmedOrder: Order = {
  ...mockPendingOrder,
  status: "CONFIRMED",
  updatedAt: "2024-01-20T15:00:00Z",
};

describe("OrderTimeline Component", () => {
  it("renders order timeline with correct title", () => {
    render(<OrderTimeline order={mockPendingOrder} />);
    expect(screen.getByText("Order Timeline")).toBeInTheDocument();
  });

  it("displays order status badge", () => {
    render(<OrderTimeline order={mockPendingOrder} />);
    expect(screen.getByText("PENDING")).toBeInTheDocument();
  });

  it("shows completed events for pending order", () => {
    render(<OrderTimeline order={mockPendingOrder} />);
    expect(screen.getByText(/Order placed and awaiting escrow funding/i)).toBeInTheDocument();
    expect(screen.getByText(/Payment secured in escrow/i)).toBeInTheDocument();
  });

  it("shows pending events for pending order", () => {
    render(<OrderTimeline order={mockPendingOrder} />);
    expect(screen.getByText(/Awaiting shipment/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending delivery confirmation/i)).toBeInTheDocument();
  });

  it("shows all events as completed for confirmed order", () => {
    render(<OrderTimeline order={mockConfirmedOrder} />);
    expect(screen.getByText(/Order placed and awaiting escrow funding/i)).toBeInTheDocument();
    expect(screen.getByText(/Payment secured in escrow/i)).toBeInTheDocument();
    expect(screen.getByText(/Order shipped by farmer/i)).toBeInTheDocument();
    expect(screen.getByText(/Order delivered and confirmed/i)).toBeInTheDocument();
  });

  it("displays next steps for pending order", () => {
    render(<OrderTimeline order={mockPendingOrder} />);
    expect(screen.getByText("Next Steps")).toBeInTheDocument();
    expect(
      screen.getByText(/Waiting for the farmer to ship your order/i)
    ).toBeInTheDocument();
  });

  it("displays completion message for confirmed order", () => {
    render(<OrderTimeline order={mockConfirmedOrder} />);
    expect(screen.getByText("Next Steps")).toBeInTheDocument();
    expect(
      screen.getByText(/Order completed successfully/i)
    ).toBeInTheDocument();
  });

  it("renders timeline with visual indicators", () => {
    const { container } = render(<OrderTimeline order={mockPendingOrder} />);
    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThan(0);
  });

  it("shows timestamps for completed events", () => {
    render(<OrderTimeline order={mockConfirmedOrder} />);
    const timestamps = screen.queryAllByText(/2024/i);
    expect(timestamps.length).toBeGreaterThan(0);
  });

  it("shows 'Not yet completed' for pending events", () => {
    render(<OrderTimeline order={mockPendingOrder} />);
    const notCompleted = screen.queryAllByText(/Not yet completed/i);
    expect(notCompleted.length).toBeGreaterThan(0);
  });
});

describe("OrderDetailsPanel Component", () => {
  it("renders order details panel with correct title", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Order Details")).toBeInTheDocument();
  });

  it("displays order ID", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Order ID")).toBeInTheDocument();
    expect(screen.getByText(/order123/i)).toBeInTheDocument();
  });

  it("displays campaign ID", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Campaign ID")).toBeInTheDocument();
    expect(screen.getByText(/campaign456/i)).toBeInTheDocument();
  });

  it("displays order amount", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("100 XLM")).toBeInTheDocument();
  });

  it("displays buyer address", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Buyer Address")).toBeInTheDocument();
    expect(screen.getByText(/GBUYER/i)).toBeInTheDocument();
  });

  it("displays transaction hash with explorer link", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    const link = screen.getByText("View on Explorer");
    expect(link).toHaveAttribute("href", expect.stringContaining("stellar.expert"));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("displays created timestamp", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("displays last updated timestamp", () => {
    render(<OrderDetailsPanel order={mockPendingOrder} />);
    expect(screen.getByText("Last Updated")).toBeInTheDocument();
  });

  it("does not show transaction hash if not available", () => {
    const orderWithoutTx = { ...mockPendingOrder, txHash: undefined };
    render(<OrderDetailsPanel order={orderWithoutTx} />);
    expect(screen.queryByText("Transaction")).not.toBeInTheDocument();
  });
});
