import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { NotificationEventType } from '../enums/notificationEventType.js';
import { NotificationService } from './notificationService.js';

export interface GroupOrderContributionDto {
  id: string;
  buyerWallet: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  status: string;
  orderIdOnChain: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupOrderDto {
  id: string;
  productId: string;
  farmerWallet: string;
  targetQuantity: string;
  committedQuantity: string;
  currency: string;
  status: string;
  windowEndsAt: Date;
  batchTxHash: string | null;
  fulfilledAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contributions: GroupOrderContributionDto[];
}

export interface GroupOrderIntentInput {
  productId: string;
  buyerWallet: string;
  quantity: string;
  targetQuantity?: string;
  expiresInMinutes?: number;
}

const DEFAULT_EXPIRY_MINUTES = 60;
const GROUP_ORDER_STATUSES = {
  pending: 'PENDING',
  finalizing: 'FINALIZING',
  fulfilling: 'FULFILLING',
  fulfilled: 'FULFILLED',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
} as const;

function toDecimal(value: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new ApiError(400, 'Bad Request', `Invalid decimal value: ${value}`);
  }
}

function toGroupOrderDto(order: {
  id: string;
  productId: string;
  farmerWallet: string;
  targetQuantity: Prisma.Decimal;
  committedQuantity: Prisma.Decimal;
  currency: string;
  status: string;
  windowEndsAt: Date;
  batchTxHash: string | null;
  fulfilledAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contributions?: Array<{
    id: string;
    buyerWallet: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    currency: string;
    status: string;
    orderIdOnChain: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): GroupOrderDto {
  return {
    id: order.id,
    productId: order.productId,
    farmerWallet: order.farmerWallet,
    targetQuantity: order.targetQuantity.toString(),
    committedQuantity: order.committedQuantity.toString(),
    currency: order.currency,
    status: order.status,
    windowEndsAt: order.windowEndsAt,
    batchTxHash: order.batchTxHash,
    fulfilledAt: order.fulfilledAt,
    expiredAt: order.expiredAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    contributions: (order.contributions ?? []).map((contribution) => ({
      id: contribution.id,
      buyerWallet: contribution.buyerWallet,
      quantity: contribution.quantity.toString(),
      unitPrice: contribution.unitPrice.toString(),
      currency: contribution.currency,
      status: contribution.status,
      orderIdOnChain: contribution.orderIdOnChain,
      createdAt: contribution.createdAt,
      updatedAt: contribution.updatedAt,
    })),
  };
}

async function notifyProgress(
  groupOrderId: string,
  buyerWallet: string,
  farmerWallet: string,
  quantity: string,
  currency: string
) {
  await Promise.allSettled([
    NotificationService.notify({
      walletAddress: buyerWallet,
      type: NotificationEventType.GROUP_ORDER_PROGRESS,
      orderId: groupOrderId,
      amount: quantity,
      token: currency,
    }),
    NotificationService.notify({
      walletAddress: farmerWallet,
      type: NotificationEventType.GROUP_ORDER_PROGRESS,
      orderId: groupOrderId,
      amount: quantity,
      token: currency,
    }),
  ]);
}

function uniqueWallets(groupOrder: {
  farmerWallet: string;
  contributions: Array<{ buyerWallet: string }>;
}): string[] {
  return Array.from(
    new Set([groupOrder.farmerWallet, ...groupOrder.contributions.map((item) => item.buyerWallet)])
  );
}

function buildBatchTxHash(groupOrderId: string): string {
  return `group-batch:${groupOrderId}:${Date.now().toString(36)}`;
}

async function submitGroupOrderBatch(groupOrderId: string) {
  const batchTxHash = buildBatchTxHash(groupOrderId);
  const orderIds: string[] = [];

  const groupOrder = await prisma.$transaction(async (tx) => {
    const claimed = await tx.groupOrder.updateMany({
      where: { id: groupOrderId, status: GROUP_ORDER_STATUSES.finalizing, batchTxHash: null },
      data: { status: GROUP_ORDER_STATUSES.fulfilling },
    });
    if (claimed.count === 0) return null;

    const current = await tx.groupOrder.findUnique({
      where: { id: groupOrderId },
      include: { contributions: true },
    });
    if (!current) throw new ApiError(404, 'Not Found', 'Group order not found');

    for (const contribution of current.contributions) {
      const order = await tx.order.create({
        data: {
          orderIdOnChain: `${current.id}:${contribution.id}`,
          buyerAddress: contribution.buyerWallet,
          sellerAddress: current.farmerWallet,
          amount: contribution.quantity.toString(),
          token: contribution.currency,
          status: 'PENDING',
          productId: current.productId,
          txHash: batchTxHash,
        },
      });

      orderIds.push(order.orderIdOnChain);

      await tx.groupOrderContribution.updateMany({
        where: { id: contribution.id },
        data: {
          status: GROUP_ORDER_STATUSES.fulfilled,
          orderIdOnChain: order.orderIdOnChain,
        },
      });
    }

    await tx.groupOrder.update({
      where: { id: current.id },
      data: {
        status: GROUP_ORDER_STATUSES.fulfilled,
        batchTxHash,
        fulfilledAt: new Date(),
      },
    });
    return current;
  });

  if (!groupOrder) return null;

  await Promise.allSettled(
    uniqueWallets(groupOrder).map((wallet) =>
      NotificationService.notify({
        walletAddress: wallet,
        type: NotificationEventType.GROUP_ORDER_FUNDED,
        orderId: groupOrder.id,
        amount: groupOrder.committedQuantity.toString(),
        token: groupOrder.currency,
      })
    )
  );

  return { batchTxHash, orderIds };
}

export async function createOrJoinGroupOrder(input: GroupOrderIntentInput): Promise<
  GroupOrderDto & {
    thresholdReached: boolean;
    batchTxHash: string | null;
    submittedOrders: string[];
  }
> {
  if (!input.productId) {
    throw new ApiError(400, 'Bad Request', 'productId is required');
  }
  if (!input.buyerWallet) {
    throw new ApiError(400, 'Bad Request', 'buyerWallet is required');
  }
  if (!input.quantity) {
    throw new ApiError(400, 'Bad Request', 'quantity is required');
  }

  const quantity = toDecimal(input.quantity);
  if (quantity.lte(0)) {
    throw new ApiError(400, 'Bad Request', 'quantity must be greater than zero');
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
  });
  if (!product) {
    throw new ApiError(404, 'Not Found', 'Product not found');
  }

  const targetQuantity = input.targetQuantity
    ? toDecimal(input.targetQuantity)
    : (product.stockQuantity ?? quantity);
  const now = new Date();
  const windowMinutes = Math.max(input.expiresInMinutes ?? DEFAULT_EXPIRY_MINUTES, 1);
  const windowEndsAt = new Date(now.getTime() + windowMinutes * 60_000);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${product.id})::bigint)`);
    const activePool = await tx.groupOrder.findFirst({
      where: {
        productId: product.id,
        farmerWallet: product.farmerWallet,
        status: GROUP_ORDER_STATUSES.pending,
        windowEndsAt: { gt: now },
      },
      include: { contributions: true },
      orderBy: { createdAt: 'asc' },
    });

    const groupOrder =
      activePool ??
      (await tx.groupOrder.create({
        data: {
          productId: product.id,
          farmerWallet: product.farmerWallet,
          targetQuantity,
          committedQuantity: new Prisma.Decimal(0),
          currency: product.currency,
          windowEndsAt,
          status: GROUP_ORDER_STATUSES.pending,
        },
        include: { contributions: true },
      }));

    const poolTargetQuantity = activePool ? activePool.targetQuantity : targetQuantity;

    const contribution = await tx.groupOrderContribution.create({
      data: {
        groupOrderId: groupOrder.id,
        buyerWallet: input.buyerWallet,
        quantity,
        unitPrice: product.pricePerUnit,
        currency: product.currency,
      },
    });

    const updatedGroupOrder = await tx.groupOrder.update({
      where: { id: groupOrder.id },
      data: {
        committedQuantity: { increment: quantity },
      },
      include: { contributions: true },
    });

    const thresholdReached = new Prisma.Decimal(updatedGroupOrder.committedQuantity).gte(
      poolTargetQuantity
    );
    const finalizationClaimed =
      thresholdReached &&
      (
        await tx.groupOrder.updateMany({
          where: { id: groupOrder.id, status: GROUP_ORDER_STATUSES.pending },
          data: { status: GROUP_ORDER_STATUSES.finalizing },
        })
      ).count === 1;
    return { groupOrder: updatedGroupOrder, contribution, thresholdReached, finalizationClaimed };
  });

  await notifyProgress(
    result.groupOrder.id,
    input.buyerWallet,
    result.groupOrder.farmerWallet,
    quantity.toString(),
    result.groupOrder.currency
  );

  if (!result.finalizationClaimed) {
    return {
      ...toGroupOrderDto(result.groupOrder),
      thresholdReached: result.thresholdReached,
      batchTxHash: result.groupOrder.batchTxHash,
      submittedOrders: [],
    };
  }

  const submission = await submitGroupOrderBatch(result.groupOrder.id);
  const fulfilled = await prisma.groupOrder.findUnique({
    where: { id: result.groupOrder.id },
    include: { contributions: true },
  });

  if (!fulfilled) {
    throw new ApiError(500, 'Internal Server Error', 'Failed to finalize group order');
  }

  return {
    ...toGroupOrderDto(fulfilled),
    thresholdReached: true,
    batchTxHash: submission?.batchTxHash ?? fulfilled.batchTxHash,
    submittedOrders: submission?.orderIds ?? [],
  };
}

export async function expireGroupOrders(now = new Date()): Promise<GroupOrderDto[]> {
  const expiredOrders = await prisma.groupOrder.findMany({
    where: {
      status: GROUP_ORDER_STATUSES.pending,
      windowEndsAt: { lte: now },
    },
    include: { contributions: true },
  });

  const expiredDtos: GroupOrderDto[] = [];

  for (const order of expiredOrders) {
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.groupOrder.updateMany({
        where: {
          id: order.id,
          status: GROUP_ORDER_STATUSES.pending,
          windowEndsAt: { lte: now },
        },
        data: {
          status: GROUP_ORDER_STATUSES.expired,
          expiredAt: now,
        },
      });
      if (claim.count === 0) return false;

      await tx.groupOrderContribution.updateMany({
        where: { groupOrderId: order.id, status: 'RESERVED' },
        data: { status: GROUP_ORDER_STATUSES.cancelled },
      });
      return true;
    });
    if (!claimed) continue;

    const refreshed = await prisma.groupOrder.findUnique({
      where: { id: order.id },
      include: { contributions: true },
    });

    if (!refreshed) {
      continue;
    }

    await Promise.allSettled(
      uniqueWallets(refreshed).map((wallet) =>
        NotificationService.notify({
          walletAddress: wallet,
          type: NotificationEventType.GROUP_ORDER_EXPIRED,
          orderId: refreshed.id,
          amount: refreshed.committedQuantity.toString(),
          token: refreshed.currency,
        })
      )
    );

    expiredDtos.push(toGroupOrderDto(refreshed));
  }

  return expiredDtos;
}

export async function finalizeReadyGroupOrders(): Promise<void> {
  const ready = await prisma.groupOrder.findMany({
    where: { status: GROUP_ORDER_STATUSES.finalizing },
    select: { id: true },
    take: 50,
  });
  for (const order of ready) {
    await submitGroupOrderBatch(order.id);
  }
}

export async function getGroupOrderById(id: string): Promise<GroupOrderDto> {
  const groupOrder = await prisma.groupOrder.findUnique({
    where: { id },
    include: { contributions: true },
  });
  if (!groupOrder) {
    throw new ApiError(404, 'Not Found', 'Group order not found');
  }
  return toGroupOrderDto(groupOrder);
}
