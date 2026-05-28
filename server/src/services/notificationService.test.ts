import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/database.js", () => ({
  prisma: {
    notification: { create: vi.fn().mockResolvedValue({ id: "notif-1" }) },
  },
  default: {},
}));
vi.mock("./wsManager.js", () => ({
  wsManager: { broadcast: vi.fn(), broadcastTo: vi.fn() },
}));
vi.mock("../utils/notificationTemplates.js", () => ({
  buildNotificationMessage: vi.fn(() => "rendered message"),
}));
vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { NotificationService } from "./notificationService.js";
import { wsManager } from "./wsManager.js";
import { prisma } from "../config/database.js";
import { NotificationEventType } from "../enums/notificationEventType.js";

const create = vi.mocked(prisma.notification.create);
const broadcastTo = vi.mocked(wsManager.broadcastTo);

describe("NotificationService.notifyFromEscrowEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: "notif-1" } as never);
  });

  it("notifies the buyer (ORDER_CREATED) and farmer (FUNDS_LOCKED) on 'created'", async () => {
    await NotificationService.notifyFromEscrowEvent({
      action: "created",
      buyerAddress: "BUYER",
      farmerAddress: "FARMER",
      orderId: "order-1",
      amount: "100",
      token: "TOKEN",
    });

    const types = create.mock.calls.map((c) => (c[0] as { data: { type: string } }).data.type);
    const wallets = create.mock.calls.map(
      (c) => (c[0] as { data: { walletAddress: string } }).data.walletAddress,
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(types).toContain(NotificationEventType.ORDER_CREATED);
    expect(types).toContain(NotificationEventType.FUNDS_LOCKED);
    expect(wallets).toEqual(expect.arrayContaining(["BUYER", "FARMER"]));
    // Each persisted notification is pushed to its owner over the socket.
    expect(broadcastTo).toHaveBeenCalledTimes(2);
  });

  it("notifies only the farmer (DELIVERY_CONFIRMED) on 'confirmed'", async () => {
    await NotificationService.notifyFromEscrowEvent({
      action: "confirmed",
      buyerAddress: "BUYER",
      farmerAddress: "FARMER",
      orderId: "order-2",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as { data: Record<string, unknown> }).data).toMatchObject({
      walletAddress: "FARMER",
      type: NotificationEventType.DELIVERY_CONFIRMED,
      orderId: "order-2",
    });
  });

  it("does nothing for an unmapped action", async () => {
    await NotificationService.notifyFromEscrowEvent({
      action: "delivered",
      orderId: "order-3",
    });

    expect(create).not.toHaveBeenCalled();
    expect(broadcastTo).not.toHaveBeenCalled();
  });
});
