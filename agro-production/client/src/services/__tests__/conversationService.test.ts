/**
 * Issue #1256: the conversation service routes its requests to the
 * endpoints `agro-production/server/src/routes/conversations.ts`
 * actually implements. The pre-#1256 service called routes the server
 * never exposed and attached an `x-session-token` header the server
 * ignored, so a signed-in investor could never load the page.
 *
 * These tests pin the service contract: they mock `apiClient` and
 * check that each call hits the right URL with the right body, no
 * `x-session-token` ever appears (the apiClient attaches
 * `Authorization: Bearer` globally via `getAccessToken`), and query
 * strings are built for the paginated history endpoint.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  default: { get: getMock, post: postMock },
}));

import {
  createCampaignConversation,
  getCampaignConversation,
  getConversationMessages,
  sendMessage,
} from "../conversationService";

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("conversationService (#1256)", () => {
  it("getCampaignConversation hits GET /campaigns/:id/conversation", async () => {
    getMock.mockResolvedValueOnce({ id: "c-1", campaignId: "camp-1" });
    await getCampaignConversation("camp-1");
    expect(getMock).toHaveBeenCalledWith("/campaigns/camp-1/conversation");
  });

  it("getCampaignConversation URL-encodes the campaign id", async () => {
    getMock.mockResolvedValueOnce(null);
    await getCampaignConversation("camp with space");
    expect(getMock).toHaveBeenCalledWith("/campaigns/camp%20with%20space/conversation");
  });

  it("createCampaignConversation hits POST /campaigns/:id/conversation with an empty body", async () => {
    postMock.mockResolvedValueOnce({ id: "c-1", campaignId: "camp-1" });
    await createCampaignConversation("camp-1");
    expect(postMock).toHaveBeenCalledWith("/campaigns/camp-1/conversation", {});
  });

  it("getConversationMessages builds a cursor + limit query string", async () => {
    getMock.mockResolvedValueOnce({ messages: [], nextCursor: undefined });
    await getConversationMessages("conv-1", { cursor: "cur-99", limit: 25 });
    expect(getMock).toHaveBeenCalledWith(
      "/conversations/conv-1/messages?cursor=cur-99&limit=25",
    );
  });

  it("getConversationMessages omits the query string when no options are passed", async () => {
    getMock.mockResolvedValueOnce({ messages: [], nextCursor: undefined });
    await getConversationMessages("conv-1");
    expect(getMock).toHaveBeenCalledWith("/conversations/conv-1/messages");
  });

  it("sendMessage posts the content to /conversations/:id/messages", async () => {
    postMock.mockResolvedValueOnce({ id: "m-1", content: "hi" });
    await sendMessage("conv-1", "hi");
    expect(postMock).toHaveBeenCalledWith("/conversations/conv-1/messages", {
      content: "hi",
    });
  });

  it("no request ever attaches an x-session-token header (#1256)", async () => {
    getMock.mockResolvedValue(null);
    postMock.mockResolvedValue({ id: "ok" });
    await getCampaignConversation("camp-1");
    await createCampaignConversation("camp-1");
    await getConversationMessages("conv-1", { limit: 50 });
    await sendMessage("conv-1", "hi");
    for (const call of [...getMock.mock.calls, ...postMock.mock.calls]) {
      const options = call[2];
      expect(options).toBeUndefined();
    }
  });
});
