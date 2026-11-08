import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MessagesPage from "../page";
import { saveWalletSession, clearWalletSession } from "@/lib/walletSession";
import { setAccessToken } from "@/lib/authToken";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-1111-1111-111111111111" }),
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("Campaign MessagesPage (#1256)", () => {
  const campaignId = "11111111-1111-1111-1111-111111111111";
  const convId = "22222222-2222-2222-2222-222222222222";
  const investorAddr = "GINVESTOR11111111111111111111111111111111111111111111111";
  const farmerAddr = "GFARMER1111111111111111111111111111111111111111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    clearWalletSession();
    setAccessToken(null);
  });

  it("renders expired session state (instead of an infinite spinner) when wallet session exists without an access token", async () => {
    saveWalletSession({ address: investorAddr, connectedAt: Date.now() });
    setAccessToken(null);

    render(<MessagesPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/your wallet session has expired/i),
      ).toBeInTheDocument();
    });
  });

  it("renders forbidden state when server returns 403", async () => {
    saveWalletSession({ address: investorAddr, connectedAt: Date.now() });
    setAccessToken("jwt-token-123");

    mockFetch.mockResolvedValueOnce(
      jsonResponse(403, {
        error: "Only farmer or investors can access campaign conversations",
      }),
    );

    render(<MessagesPage />);
    await waitFor(() => {
      expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    });
  });

  it("creates a conversation from empty state, loads paginated message history with Bearer auth, and sends a message", async () => {
    saveWalletSession({ address: investorAddr, connectedAt: Date.now() });
    setAccessToken("jwt-token-123");

    // 1. GET /campaigns/:campaignId/conversation -> null (empty state)
    mockFetch.mockResolvedValueOnce(jsonResponse(200, null));

    // 2. POST /campaigns/:campaignId/conversation -> created conversation
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        id: convId,
        campaignId,
        investorAddress: investorAddr,
        farmerAddress: farmerAddr,
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-01T10:00:00.000Z",
      }),
    );

    // 3. GET /conversations/:id/messages?limit=20 -> initial history with nextCursor
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        messages: [
          {
            id: "m-2",
            conversationId: convId,
            senderAddress: farmerAddr,
            content: "Welcome to the campaign!",
            createdAt: "2026-11-01T10:05:00.000Z",
          },
        ],
        nextCursor: "m-1",
      }),
    );

    // 4. GET /conversations/:id/messages?cursor=m-1&limit=20 -> older page
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        messages: [
          {
            id: "m-1",
            conversationId: convId,
            senderAddress: investorAddr,
            content: "Earlier question about harvest schedule",
            createdAt: "2026-11-01T10:01:00.000Z",
          },
        ],
      }),
    );

    // 5. POST /conversations/:id/messages -> new message
    mockFetch.mockResolvedValueOnce(
      jsonResponse(201, {
        id: "m-3",
        conversationId: convId,
        senderAddress: investorAddr,
        content: "Looking forward to harvest!",
        createdAt: "2026-11-01T10:10:00.000Z",
      }),
    );

    render(<MessagesPage />);

    // Wait for empty state & click Start conversation
    const startBtn = await screen.findByRole("button", {
      name: /start conversation/i,
    });
    fireEvent.click(startBtn);

    // Verify initial history message renders
    await waitFor(() => {
      expect(screen.getByText("Welcome to the campaign!")).toBeInTheDocument();
    });

    // Verify Bearer header was sent to /campaigns/:campaignId/conversation
    expect(mockFetch.mock.calls[0][0]).toContain(
      `/campaigns/${campaignId}/conversation`,
    );
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer jwt-token-123",
    );

    // Load older messages via cursor pagination
    const olderBtn = await screen.findByRole("button", {
      name: /load older messages/i,
    });
    fireEvent.click(olderBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Earlier question about harvest schedule"),
      ).toBeInTheDocument();
    });

    // Send a new message
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, {
      target: { value: "Looking forward to harvest!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Looking forward to harvest!"),
      ).toBeInTheDocument();
    });
  });
});
