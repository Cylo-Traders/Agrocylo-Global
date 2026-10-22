import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageThread from "../MessageThread";
import type { Conversation } from "@/services/conversationService";

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(),
}));

describe("MessageThread character limit (#1254)", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  const mockConversation: Conversation = {
    id: "11111111-1111-4111-8111-111111111111",
    campaignId: "33333333-3333-4333-8333-333333333333",
    farmerAddress: "GFARMER111111111111111111111111111111111111111111111111111",
    investorAddress: "GINVESTOR11111111111111111111111111111111111111111111111111",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  it("enforces 4000-character maximum on message input and renders 4000 limit counter", () => {
    render(
      <MessageThread
        conversation={mockConversation}
        currentWallet="GINVESTOR11111111111111111111111111111111111111111111111111"
        sessionToken="mock-session-token"
      />,
    );

    const input = screen.getByPlaceholderText("Type a message...");
    expect(input).toHaveAttribute("maxLength", "4000");
    expect(screen.getByText("0/4000")).toBeInTheDocument();
  });
});
