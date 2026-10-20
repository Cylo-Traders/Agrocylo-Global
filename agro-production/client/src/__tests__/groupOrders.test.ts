import { describe, expect, it, vi } from "vitest";
import {
  applyGroupOrderUpdate,
  fetchGroupOrders,
  joinGroupOrderPool,
  type GroupOrder,
} from "@/services/groupOrderService";

const sampleOrders: GroupOrder[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    productName: "Bulk Organic Fertilizer (50kg)",
    currentQuantity: 4,
    targetQuantity: 10,
    pricePerUnit: 25,
    expiresAt: "2026-12-31T00:00:00.000Z",
    status: "open",
  },
];

describe("groupOrderService client contract (#1257)", () => {
  it("fetches group orders via shared API client at /group-orders", async () => {
    const mockGet = vi.fn().mockResolvedValue(sampleOrders);

    const orders = await fetchGroupOrders({ client: { get: mockGet } });
    expect(mockGet).toHaveBeenCalledWith("/group-orders", {
      auth: false,
      signal: undefined,
    });
    expect(orders).toEqual(sampleOrders);
  });

  it("returns an empty list when the API returns an empty array", async () => {
    const mockGet = vi.fn().mockResolvedValue([]);
    const orders = await fetchGroupOrders({ client: { get: mockGet } });
    expect(orders).toEqual([]);
  });

  it("posts authenticated join requests with retries: 0 and X-Idempotency-Key", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      ...sampleOrders[0],
      currentQuantity: 5,
      joined: true,
      idempotentReplay: false,
    });

    const res = await joinGroupOrderPool(sampleOrders[0]!.id, {
      client: { post: mockPost },
      quantity: 1,
      idempotencyKey: "join:pool-1",
    });

    expect(mockPost).toHaveBeenCalledWith(
      `/group-orders/${sampleOrders[0]!.id}/join`,
      { quantity: 1 },
      {
        retries: 0,
        headers: { "X-Idempotency-Key": "join:pool-1" },
      },
    );
    expect(res.currentQuantity).toBe(5);
    expect(res.joined).toBe(true);
  });

  it("propagates non-2xx API errors from joinGroupOrderPool so the UI can surface them", async () => {
    const mockPost = vi
      .fn()
      .mockRejectedValue(new Error("This group order has expired"));

    await expect(
      joinGroupOrderPool(sampleOrders[0]!.id, { client: { post: mockPost } }),
    ).rejects.toThrow("This group order has expired");
  });

  it("applies versioned group_order.updated live progress and transitions status to completed at target", () => {
    const afterPartial = applyGroupOrderUpdate(sampleOrders, {
      orderId: sampleOrders[0]!.id,
      currentQuantity: 7,
    });
    expect(afterPartial[0]?.currentQuantity).toBe(7);
    expect(afterPartial[0]?.status).toBe("open");

    const afterTarget = applyGroupOrderUpdate(afterPartial, {
      orderId: sampleOrders[0]!.id,
      currentQuantity: 10,
    });
    expect(afterTarget[0]?.currentQuantity).toBe(10);
    expect(afterTarget[0]?.status).toBe("completed");
  });
});
