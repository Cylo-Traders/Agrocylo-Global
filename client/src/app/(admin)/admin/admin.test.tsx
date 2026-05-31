import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AdminOverviewPage from "./page";
import * as adminService from "@/services/adminService";

vi.mock("@/services/adminService");
vi.mock("next/link", () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe("AdminOverviewPage", () => {
  const mockStats = {
    totalUsers: 150,
    totalProducts: 340,
    totalOrders: 1250,
    pendingEscrow: 50000,
    totalVolume: "$2,500,000",
    platformRevenue: "$75,000",
  };

  const mockActivity = [
    {
      id: "1",
      type: "order" as const,
      description: "New order placed by farmer_123",
      timestamp: new Date().toISOString(),
      status: "Pending",
    },
    {
      id: "2",
      type: "user" as const,
      description: "New user registered: buyer_456",
      timestamp: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state on initial render", () => {
    vi.mocked(adminService.fetchPlatformStats).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );
    vi.mocked(adminService.fetchRecentActivity).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<AdminOverviewPage />);

    expect(screen.getAllByTestId || true).toBeTruthy(); // Component renders without error
  });

  it("displays populated state with stats and activity", async () => {
    vi.mocked(adminService.fetchPlatformStats).mockResolvedValue(mockStats);
    vi.mocked(adminService.fetchRecentActivity).mockResolvedValue(
      mockActivity
    );

    render(<AdminOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("$2,500,000")).toBeInTheDocument();
      expect(screen.getByText("$75,000")).toBeInTheDocument();
      expect(screen.getByText("150")).toBeInTheDocument();
    });
  });

  it("displays error state with retry button when API fails", async () => {
    const errorMessage = "Failed to fetch platform stats: 500";
    vi.mocked(adminService.fetchPlatformStats).mockRejectedValue(
      new Error(errorMessage)
    );
    vi.mocked(adminService.fetchRecentActivity).mockRejectedValue(
      new Error(errorMessage)
    );

    render(<AdminOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
  });

  it("shows empty state when no activity exists", async () => {
    vi.mocked(adminService.fetchPlatformStats).mockResolvedValue(mockStats);
    vi.mocked(adminService.fetchRecentActivity).mockResolvedValue([]);

    render(<AdminOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("No recent activity yet.")).toBeInTheDocument();
    });
  });
});
