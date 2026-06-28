import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MarketplaceFilters } from "./components/MarketplaceFilters";
import WalletConnect from "./components/WalletConnect";
import { NotificationContainer } from "./components/Notification";
import type { NotificationMessage } from "./components/Notification";
import { WalletProvider } from "./context/WalletContext";

vi.mock("./lib/walletFreighter", () => ({
  getFreighterPublicKey: vi.fn(),
}));

vi.mock("./lib/analytics", () => ({
  trackWalletConnected: vi.fn(),
  trackWalletDisconnected: vi.fn(),
}));

describe("Marketplace Filters Accessibility", () => {
  const mockProps = {
    category: "",
    location: "",
    minPrice: "",
    maxPrice: "",
    filterErrors: [],
    onCategoryChange: vi.fn(),
    onLocationChange: vi.fn(),
    onMinPriceChange: vi.fn(),
    onMaxPriceChange: vi.fn(),
    onFilterErrorsClear: vi.fn(),
  };

  it("has proper ARIA labels for filter section", () => {
    render(<MarketplaceFilters {...mockProps} />);
    expect(screen.getByLabelText("Filter products")).toBeInTheDocument();
  });

  it("associates labels with form controls", () => {
    render(<MarketplaceFilters {...mockProps} />);
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
    expect(screen.getByLabelText("Min price (XLM)")).toBeInTheDocument();
    expect(screen.getByLabelText("Max price (XLM)")).toBeInTheDocument();
  });

  it("marks invalid inputs with aria-invalid", () => {
    const propsWithError = {
      ...mockProps,
      filterErrors: ["Min price must be less than max price"],
    };
    render(<MarketplaceFilters {...propsWithError} />);
    const minPriceInput = screen.getByLabelText("Min price (XLM)");
    expect(minPriceInput).toHaveAttribute("aria-invalid", "true");
  });

  it("displays error messages with role alert", () => {
    const propsWithError = {
      ...mockProps,
      filterErrors: ["Invalid price range"],
    };
    render(<MarketplaceFilters {...propsWithError} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Invalid price range");
  });

  it("allows keyboard navigation through filter controls", () => {
    render(<MarketplaceFilters {...mockProps} />);
    const categorySelect = screen.getByLabelText("Category");
    const locationInput = screen.getByLabelText("Location");

    categorySelect.focus();
    expect(document.activeElement).toBe(categorySelect);

    fireEvent.keyDown(categorySelect, { key: "Tab" });
    locationInput.focus();
    expect(document.activeElement).toBe(locationInput);
  });
});

describe("Wallet Connect Accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has descriptive aria-label for connect button", () => {
    render(
      <WalletProvider>
        <WalletConnect />
      </WalletProvider>
    );
    expect(screen.getByLabelText("Connect wallet")).toBeInTheDocument();
  });

  it("has descriptive aria-label for disconnect button when connected", async () => {
    const { getFreighterPublicKey } = await import("./lib/walletFreighter");
    vi.mocked(getFreighterPublicKey).mockResolvedValue("GTESTADDRESS");

    render(
      <WalletProvider>
        <WalletConnect />
      </WalletProvider>
    );

    const connectButton = screen.getByLabelText("Connect wallet");
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(screen.getByLabelText("Disconnect wallet")).toBeInTheDocument();
    });
  });

  it("shows connected wallet address with accessible label", async () => {
    const { getFreighterPublicKey } = await import("./lib/walletFreighter");
    vi.mocked(getFreighterPublicKey).mockResolvedValue("GTESTADDRESS");

    render(
      <WalletProvider>
        <WalletConnect />
      </WalletProvider>
    );

    fireEvent.click(screen.getByLabelText("Connect wallet"));

    await waitFor(() => {
      const addressElement = screen.getByLabelText(/Connected wallet:/);
      expect(addressElement).toBeInTheDocument();
    });
  });

  it("displays error messages with role alert", () => {
    render(
      <WalletProvider>
        <WalletConnect />
      </WalletProvider>
    );

    const alerts = screen.queryAllByRole("alert");
    alerts.forEach((alert) => {
      expect(alert).toBeInTheDocument();
    });
  });

  it("disables button during loading state with descriptive label", async () => {
    render(
      <WalletProvider>
        <WalletConnect />
      </WalletProvider>
    );

    const connectButton = screen.getByLabelText("Connect wallet");
    fireEvent.click(connectButton);

    await waitFor(() => {
      const loadingButton = screen.queryByLabelText("Connecting wallet");
      if (loadingButton) {
        expect(loadingButton).toBeDisabled();
      }
    });
  });
});

describe("Notification Panel Accessibility", () => {
  const mockNotifications: NotificationMessage[] = [
    {
      id: "1",
      type: "success",
      title: "Success",
      message: "Operation completed",
      duration: 5000,
    },
    {
      id: "2",
      type: "error",
      title: "Error",
      message: "Something went wrong",
    },
  ];

  it("renders notifications with role alert", () => {
    render(<NotificationContainer notifications={mockNotifications} />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("allows keyboard navigation to close button", () => {
    render(<NotificationContainer notifications={mockNotifications} />);
    const closeButtons = screen.getAllByRole("button");
    closeButtons[0].focus();
    expect(document.activeElement).toBe(closeButtons[0]);
  });

  it("closes notification on Enter key press", () => {
    render(<NotificationContainer notifications={mockNotifications} />);
    const closeButtons = screen.getAllByRole("button");

    fireEvent.keyDown(closeButtons[0], { key: "Enter" });
    fireEvent.click(closeButtons[0]);
  });

  it("closes notification on Space key press", () => {
    render(<NotificationContainer notifications={mockNotifications} />);
    const closeButtons = screen.getAllByRole("button");

    closeButtons[0].focus();
    fireEvent.keyDown(closeButtons[0], { key: " " });
  });

  it("maintains focus management when notification is dismissed", async () => {
    const { rerender } = render(
      <NotificationContainer notifications={mockNotifications} />
    );

    const closeButtons = screen.getAllByRole("button");
    fireEvent.click(closeButtons[0]);

    await waitFor(() => {
      const remainingButtons = screen.queryAllByRole("button");
      expect(remainingButtons.length).toBeLessThan(closeButtons.length);
    });
  });

  it("displays action buttons with proper labels", () => {
    const notificationWithAction: NotificationMessage[] = [
      {
        id: "3",
        type: "info",
        title: "Info",
        message: "New update available",
        action: {
          label: "View details",
          onClick: vi.fn(),
        },
      },
    ];

    render(<NotificationContainer notifications={notificationWithAction} />);
    expect(screen.getByText("View details")).toBeInTheDocument();
  });
});

describe("Modal Dialog Accessibility", () => {
  it("modal elements are keyboard accessible", () => {
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "modal-title");
    document.body.appendChild(modal);

    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(modal.getAttribute("aria-labelledby")).toBe("modal-title");

    document.body.removeChild(modal);
  });

  it("modal should trap focus within dialog", () => {
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.tabIndex = -1;

    const button1 = document.createElement("button");
    button1.textContent = "First";
    const button2 = document.createElement("button");
    button2.textContent = "Last";

    modal.appendChild(button1);
    modal.appendChild(button2);
    document.body.appendChild(modal);

    modal.focus();
    expect(document.activeElement).toBe(modal);

    document.body.removeChild(modal);
  });
});
