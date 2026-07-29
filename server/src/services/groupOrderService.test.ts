import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const mock: any = {};
  mock.prisma = {
    product: {
      findUnique: vi.fn(),
    },
    groupOrder: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    groupOrderContribution: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    order: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (client: any) => Promise<unknown>) => cb(mock.prisma as never)),
  };
  return mock;
});

vi.mock("../config/database.js", () => ({
  prisma: dbMock.prisma,
}));

vi.mock("./notificationService.js", () => ({
  NotificationService: {
    notify: vi.fn(),
  },
}));

import { prisma } from "../config/database.js";
import { NotificationService } from "./notificationService.js";
import {
  createOrJoinGroupOrder,
  expireGroupOrders,
} from "./groupOrderService.js";

const prismaMock = prisma as unknown as {
  product: { findUnique: ReturnType<typeof vi.fn> };
  groupOrder: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  groupOrderContribution: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  order: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("groupOrderService", () => {
  it("submits the batch when the threshold is reached", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: "p1",
      farmerWallet: "FARMER",
      currency: "USDC",
      pricePerUnit: {
        toString: () => "12.50",
      },
      stockQuantity: null,
    } as never);
    prismaMock.groupOrder.findFirst.mockResolvedValue(null);
    prismaMock.groupOrder.create.mockResolvedValue({
      id: "go1",
      productId: "p1",
      farmerWallet: "FARMER",
      targetQuantity: {
        toString: () => "5",
      },
      committedQuantity: {
        toString: () => "0",
      },
      currency: "USDC",
      status: "PENDING",
      windowEndsAt: new Date("2026-07-27T01:00:00.000Z"),
      batchTxHash: null,
      fulfilledAt: null,
      expiredAt: null,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
      contributions: [],
    } as never);
    prismaMock.groupOrderContribution.create.mockResolvedValue({
      id: "c1",
      buyerWallet: "BUYER",
      quantity: {
        toString: () => "5",
      },
      unitPrice: {
        toString: () => "12.50",
      },
      currency: "USDC",
      status: "RESERVED",
      orderIdOnChain: null,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    } as never);
    prismaMock.groupOrder.update.mockResolvedValue({
      id: "go1",
      productId: "p1",
      farmerWallet: "FARMER",
      targetQuantity: {
        toString: () => "5",
      },
      committedQuantity: {
        toString: () => "5",
      },
      currency: "USDC",
      status: "PENDING",
      windowEndsAt: new Date("2026-07-27T01:00:00.000Z"),
      batchTxHash: null,
      fulfilledAt: null,
      expiredAt: null,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
      contributions: [
        {
          id: "c1",
          buyerWallet: "BUYER",
          quantity: {
            toString: () => "5",
          },
          unitPrice: {
            toString: () => "12.50",
          },
          currency: "USDC",
          status: "RESERVED",
          orderIdOnChain: null,
          createdAt: new Date("2026-07-27T00:00:00.000Z"),
          updatedAt: new Date("2026-07-27T00:00:00.000Z"),
        },
      ],
    } as never);
    prismaMock.groupOrder.findUnique.mockResolvedValue({
      id: "go1",
      productId: "p1",
      farmerWallet: "FARMER",
      targetQuantity: {
        toString: () => "5",
      },
      committedQuantity: {
        toString: () => "5",
      },
      currency: "USDC",
      status: "FULFILLED",
      windowEndsAt: new Date("2026-07-27T01:00:00.000Z"),
      batchTxHash: "group-batch:go1:abc",
      fulfilledAt: new Date("2026-07-27T00:10:00.000Z"),
      expiredAt: null,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:10:00.000Z"),
      contributions: [
        {
          id: "c1",
          buyerWallet: "BUYER",
          quantity: {
            toString: () => "5",
          },
          unitPrice: {
            toString: () => "12.50",
          },
          currency: "USDC",
          status: "FULFILLED",
          orderIdOnChain: "go1:c1",
          createdAt: new Date("2026-07-27T00:00:00.000Z"),
          updatedAt: new Date("2026-07-27T00:10:00.000Z"),
        },
      ],
    } as never);
    prismaMock.order.create.mockResolvedValue({
      orderIdOnChain: "go1:c1",
    } as never);

    const result = await createOrJoinGroupOrder({
      productId: "p1",
      buyerWallet: "BUYER",
      quantity: "5",
      targetQuantity: "5",
    });

    expect(result.thresholdReached).toBe(true);
    expect(result.submittedOrders).toEqual(["go1:c1"]);
    expect(result.status).toBe("FULFILLED");
    expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
    expect(NotificationService.notify).toHaveBeenCalled();
  });

  it("keeps the pool open when the threshold is not reached", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: "p1",
      farmerWallet: "FARMER",
      currency: "USDC",
      pricePerUnit: {
        toString: () => "12.50",
      },
      stockQuantity: null,
    } as never);
    prismaMock.groupOrder.findFirst.mockResolvedValue(null);
    prismaMock.groupOrder.create.mockResolvedValue({
      id: "go1",
      productId: "p1",
      farmerWallet: "FARMER",
      targetQuantity: {
        toString: () => "10",
      },
      committedQuantity: {
        toString: () => "0",
      },
      currency: "USDC",
      status: "PENDING",
      windowEndsAt: new Date("2026-07-27T01:00:00.000Z"),
      batchTxHash: null,
      fulfilledAt: null,
      expiredAt: null,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
      contributions: [],
    } as never);
    prismaMock.groupOrderContribution.create.mockResolvedValue({
      id: "c1",
      buyerWallet: "BUYER",
      quantity: {
        toString: () => "3",
      },
      unitPrice: {
        toString: () => "12.50",
      },
      currency: "USDC",
      status: "RESERVED",
      orderIdOnChain: null,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    } as never);
    prismaMock.groupOrder.update.mockResolvedValue({
      id: "go1",
      productId: "p1",
      farmerWallet: "FARMER",
      targetQuantity: {
        toString: () => "10",
      },
      committedQuantity: {
        toString: () => "3",
      },
      currency: "USDC",
      status: "PENDING",
      windowEndsAt: new Date("2026-07-27T01:00:00.000Z"),
      batchTxHash: null,
      fulfilledAt: null,
      expiredAt: null,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
      contributions: [],
    } as never);

    const result = await createOrJoinGroupOrder({
      productId: "p1",
      buyerWallet: "BUYER",
      quantity: "3",
      targetQuantity: "10",
    });

    expect(result.thresholdReached).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(result.submittedOrders).toHaveLength(0);
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("expires stale pools and marks contributions refunded", async () => {
    prismaMock.groupOrder.findMany.mockResolvedValue([
      {
        id: "go1",
        productId: "p1",
        farmerWallet: "FARMER",
        targetQuantity: {
          toString: () => "10",
        },
        committedQuantity: {
          toString: () => "4",
        },
        currency: "USDC",
        status: "PENDING",
        windowEndsAt: new Date("2026-07-26T23:00:00.000Z"),
        batchTxHash: null,
        fulfilledAt: null,
        expiredAt: null,
        createdAt: new Date("2026-07-26T22:00:00.000Z"),
        updatedAt: new Date("2026-07-26T22:00:00.000Z"),
        contributions: [
          {
            id: "c1",
            buyerWallet: "BUYER",
            quantity: {
              toString: () => "4",
            },
            unitPrice: {
              toString: () => "12.50",
            },
            currency: "USDC",
            status: "RESERVED",
            orderIdOnChain: null,
            createdAt: new Date("2026-07-26T22:00:00.000Z"),
            updatedAt: new Date("2026-07-26T22:00:00.000Z"),
          },
        ],
      },
    ] as never);
    prismaMock.groupOrder.update.mockResolvedValue({} as never);
    prismaMock.groupOrderContribution.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.groupOrder.findUnique.mockResolvedValue({
      id: "go1",
      productId: "p1",
      farmerWallet: "FARMER",
      targetQuantity: {
        toString: () => "10",
      },
      committedQuantity: {
        toString: () => "4",
      },
      currency: "USDC",
      status: "EXPIRED",
      windowEndsAt: new Date("2026-07-26T23:00:00.000Z"),
      batchTxHash: null,
      fulfilledAt: null,
      expiredAt: new Date("2026-07-27T00:00:00.000Z"),
      createdAt: new Date("2026-07-26T22:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
      contributions: [
        {
          id: "c1",
          buyerWallet: "BUYER",
          quantity: {
            toString: () => "4",
          },
          unitPrice: {
            toString: () => "12.50",
          },
          currency: "USDC",
          status: "REFUNDED",
          orderIdOnChain: null,
          createdAt: new Date("2026-07-26T22:00:00.000Z"),
          updatedAt: new Date("2026-07-27T00:00:00.000Z"),
        },
      ],
    } as never);

    const expired = await expireGroupOrders(new Date("2026-07-27T00:00:00.000Z"));

    expect(expired).toHaveLength(1);
    expect(expired[0]?.status).toBe("EXPIRED");
    expect(prismaMock.groupOrderContribution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ groupOrderId: "go1" }),
      }),
    );
    expect(NotificationService.notify).toHaveBeenCalled();
  });
});
