import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import logger from "../../config/logger.js";
import type { IndexedEvent } from "../../types/indexedEvent.js";
import { ReferralService } from "../referralService.js";
import { canonicalizeAmount } from "../../lib/money.js";
import { IdentityService } from "../identityService.js";

type PrismaTx = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$use" | "$extends">;

// Helper to detect Prisma unique violation (P2002)
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function canonicalAmountOrThrow(raw: string | undefined, fieldName: string): string {
  if (raw === undefined || raw === null) return "0";
  const trimmed = String(raw).trim();
  if (trimmed === "") return "0";
  try {
    return canonicalizeAmount(trimmed);
  } catch (e) {
    throw new Error(`Invalid ${fieldName} amount "${raw}": ${(e as Error).message}`);
  }
}

function canonicalWallet(addr: string | undefined): string | null {
  if (!addr || addr.trim() === "") return null;
  return addr.trim().toLowerCase();
}

export class BlockchainEventPersistenceService {
  static async persist(event: IndexedEvent): Promise<void> {
    try {
      // Fast outside-tx check (optimistic)
      const existing = await prisma.blockchainTransaction.findUnique({
        where: { sourceEventId: event.sourceEventId },
      });
      if (existing) return;

      try {
        await prisma.$transaction(async (tx: PrismaTx) => {
          // In-transaction dedup to handle concurrent Promise.allSettled race / replay
          const dup1 = await tx.blockchainTransaction.findUnique({
            where: { sourceEventId: event.sourceEventId },
          });
          if (dup1) return;
          // Also check ledger+eventIndex composite (mirrors @@unique)
          const dup2 = await (tx as any).blockchainTransaction.findUnique?.({
            where: { ledger_eventIndex: { ledger: event.ledger, eventIndex: event.eventIndex } },
          });
          // If composite check not available via typed client, fallback to findFirst
          if (!dup2) {
            const dup2Fallback = await tx.blockchainTransaction.findFirst({
              where: { ledger: event.ledger, eventIndex: event.eventIndex },
            });
            if (dup2Fallback) return;
          } else if (dup2) {
            return;
          }

          await this.upsertUsers(tx, event);
          await this.projectEntity(tx, event);
          await tx.blockchainTransaction.create({
            data: {
              sourceEventId: event.sourceEventId,
              eventType: event.eventType,
              entity: event.entity,
              action: event.action,
              ledger: event.ledger,
              eventIndex: event.eventIndex,
              txHash: event.txHash ?? null,
              campaignIdOnChain: event.campaignIdOnChain ?? null,
              orderIdOnChain: event.orderIdOnChain ?? null,
              payload: event.payload as Prisma.InputJsonValue,
              createdAt: event.timestamp,
            },
          });
        });
      } catch (txError) {
        // Idempotent: unique violation means another concurrent writer or replay already inserted
        if (isUniqueViolation(txError)) {
          logger.warn("Blockchain event already persisted (unique violation, idempotent replay)", {
            sourceEventId: event.sourceEventId,
            ledger: event.ledger,
            eventIndex: event.eventIndex,
          });
          return;
        }
        throw txError;
      }

      // Referral rewards only fire on a real, first confirmed economic event
      await this.triggerReferralRewardIfApplicable(event);
    } catch (error) {
      // Quarantine poisoned events to dead_letters without halting checkpoint — caller (watcher) will catch and advance
      const isValidationError =
        error instanceof Error &&
        (error.message.includes("Invalid") || error.message.includes("amount") || error.message.includes("wallet"));
      if (isValidationError) {
        try {
          await prisma.deadLetter.upsert({
            where: { sourceEventId: event.sourceEventId },
            update: {
              reason: error instanceof Error ? error.message : String(error),
              payload: event.payload as Prisma.InputJsonValue,
            },
            create: {
              sourceEventId: event.sourceEventId,
              ledger: event.ledger,
              eventIndex: event.eventIndex,
              eventType: event.eventType,
              reason: error instanceof Error ? error.message : String(error),
              payload: event.payload as Prisma.InputJsonValue,
            },
          });
          logger.warn("Event quarantined to dead_letters", { sourceEventId: event.sourceEventId, error: (error as Error).message });
          return; // swallow to prevent halting checkpoint
        } catch (deadErr) {
          logger.error("Failed to write dead_letter", { deadErr, originalError: error });
        }
      }
      logger.error("Failed to persist indexed blockchain event", { event, error });
      throw error;
    }
  }

  private static async triggerReferralRewardIfApplicable(event: IndexedEvent): Promise<void> {
    try {
      if (event.eventType === "order.confirmed" && event.actorAddress) {
        const canonicalActor = canonicalWallet(event.actorAddress);
        if (!canonicalActor) return;
        const order = event.orderIdOnChain
          ? await prisma.order.findUnique({ where: { orderIdOnChain: event.orderIdOnChain } })
          : null;
        // Use canonical amount if available; fallback to event amount
        let amount = order?.amount ?? event.amount ?? "0";
        try {
          amount = canonicalizeAmount(amount);
        } catch {
          // keep raw if canonical fails, referral service will validate
        }
        await ReferralService.triggerRewardOnConfirmedActivity({
          refereeWallet: canonicalActor,
          amount,
          triggerOrderId: event.orderIdOnChain,
        });
      } else if (event.eventType === "campaign.invested" && event.actorAddress) {
        const canonicalActor = canonicalWallet(event.actorAddress);
        if (!canonicalActor) return;
        let amount = event.amount ?? "0";
        try {
          amount = canonicalizeAmount(amount);
        } catch {}
        await ReferralService.triggerRewardOnConfirmedActivity({
          refereeWallet: canonicalActor,
          amount,
          triggerCampaignId: event.campaignIdOnChain,
        });
      }
    } catch (error) {
      logger.error("Failed to evaluate referral reward for event", { event, error });
    }
  }

  private static async upsertUsers(tx: PrismaTx, event: IndexedEvent): Promise<void> {
    // Use canonical identity service (single code path with authService)
    await IdentityService.ensureUsersForEvent(tx as any, event.actorAddress, event.secondaryAddress);
  }

  private static async projectEntity(tx: PrismaTx, event: IndexedEvent): Promise<void> {
    switch (event.eventType) {
      case "campaign.created": {
        const canonicalAmount = canonicalAmountOrThrow(event.amount, "campaign.goalAmount");
        const canonicalCreator = canonicalWallet(event.actorAddress);
        if (!event.campaignIdOnChain) throw new Error("campaign.created missing campaignIdOnChain");
        await tx.campaign.upsert({
          where: { campaignIdOnChain: event.campaignIdOnChain },
          update: {
            creatorAddress: canonicalCreator ?? event.actorAddress ?? "",
            goalAmount: canonicalAmount,
            token: event.token ?? "",
            status: CampaignStatus.ACTIVE,
          },
          create: {
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            creatorAddress: canonicalCreator ?? event.actorAddress ?? "",
            goalAmount: canonicalAmount,
            token: event.token ?? "",
            status: CampaignStatus.ACTIVE,
          },
        });
        return;
      }
      case "campaign.invested": {
        const canonicalAmount = canonicalAmountOrThrow(event.amount, "investment.amount");
        if (!event.campaignIdOnChain) throw new Error("campaign.invested missing campaignIdOnChain");
        // Ensure campaign exists as placeholder if not yet created (avoid FK orphan, but campaign has no FK)
        await tx.campaign.upsert({
          where: { campaignIdOnChain: event.campaignIdOnChain },
          update: {},
          create: {
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            creatorAddress: "",
            goalAmount: "0",
            token: event.token ?? "",
            status: CampaignStatus.ACTIVE,
          },
        });
        await tx.investment.upsert({
          where: { sourceEventId: event.sourceEventId },
          update: {},
          create: {
            sourceEventId: event.sourceEventId,
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            investorAddress: canonicalWallet(event.actorAddress) ?? event.actorAddress ?? "",
            amount: canonicalAmount,
            token: event.token ?? "",
            txHash: event.txHash ?? null,
            createdAt: event.timestamp,
          },
        });
        return;
      }
      case "campaign.settled": {
        if (!event.campaignIdOnChain) throw new Error("campaign.settled missing campaignIdOnChain");
        await tx.campaign.upsert({
          where: { campaignIdOnChain: event.campaignIdOnChain },
          update: { status: event.status ?? CampaignStatus.SETTLED },
          create: {
            campaignIdOnChain: event.campaignIdOnChain ?? "",
            creatorAddress: canonicalWallet(event.actorAddress) ?? event.actorAddress ?? "",
            goalAmount: "0",
            token: event.token ?? "",
            status: event.status ?? CampaignStatus.SETTLED,
          },
        });
        return;
      }
      case "order.created": {
        if (!event.orderIdOnChain) throw new Error("order.created missing orderIdOnChain");
        const canonicalAmount = canonicalAmountOrThrow(event.amount, "order.amount");
        const buyer = canonicalWallet(event.actorAddress);
        const seller = canonicalWallet(event.secondaryAddress);
        const existing = await tx.order.findUnique({ where: { orderIdOnChain: event.orderIdOnChain } });
        if (existing) {
          // If placeholder (needsBackfill) exists, backfill missing fields and clear flag, but preserve later status
          if ((existing as any).needsBackfill) {
            // Preserve status if it's already beyond PENDING — delivered/completed/refunded are later than created
            const shouldKeepStatus = existing.status !== "PENDING";
            await tx.order.update({
              where: { orderIdOnChain: event.orderIdOnChain },
              data: {
                buyerAddress: buyer ?? (existing as any).buyerAddress,
                sellerAddress: seller ?? (existing as any).sellerAddress,
                amount: canonicalAmount,
                token: event.token ?? (existing as any).token,
                status: shouldKeepStatus ? existing.status : "PENDING",
                needsBackfill: false,
              } as any,
            });
          } else {
            // Existing real order — idempotent update, only fill if missing, don't downgrade status
            // If status already COMPLETED/REFUNDED etc, don't revert to PENDING
            const finalStatuses = new Set(["COMPLETED", "REFUNDED", "DISPUTED", "DELIVERED"]);
            if (finalStatuses.has(existing.status)) {
              // Just ensure amount/token not stuck at "0" if they were placeholder (should not happen now)
              if (existing.amount === "0" || !existing.sellerAddress || !existing.buyerAddress) {
                await tx.order.update({
                  where: { orderIdOnChain: event.orderIdOnChain },
                  data: {
                    buyerAddress: buyer ?? existing.buyerAddress,
                    sellerAddress: seller ?? existing.sellerAddress,
                    amount: canonicalAmount,
                    token: event.token ?? existing.token,
                  } as any,
                });
              }
              return;
            }
            await tx.order.update({
              where: { orderIdOnChain: event.orderIdOnChain },
              data: {
                buyerAddress: buyer ?? existing.buyerAddress,
                sellerAddress: seller ?? existing.sellerAddress,
                amount: canonicalAmount,
                token: event.token ?? existing.token,
                status: "PENDING",
              } as any,
            });
          }
          return;
        }
        // No existing — normal create
        await tx.order.create({
          data: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: buyer,
            sellerAddress: seller,
            amount: canonicalAmount,
            token: event.token ?? "",
            status: "PENDING",
            needsBackfill: false,
          } as any,
        });
        return;
      }
      case "order.delivered": {
        if (!event.orderIdOnChain) throw new Error("order.delivered missing orderIdOnChain");
        const buyer = canonicalWallet(event.secondaryAddress);
        const seller = canonicalWallet(event.actorAddress);
        const existing = await tx.order.findUnique({ where: { orderIdOnChain: event.orderIdOnChain } });
        if (existing) {
          await tx.order.update({
            where: { orderIdOnChain: event.orderIdOnChain },
            data: { status: "DELIVERED", needsBackfill: false } as any,
          });
          return;
        }
        // Out-of-order: create placeholder with needsBackfill=true, nullable addresses handled
        await tx.order.create({
          data: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: buyer,
            sellerAddress: seller,
            amount: "0",
            token: "",
            status: "DELIVERED",
            needsBackfill: true,
          } as any,
        });
        return;
      }
      case "order.confirmed": {
        if (!event.orderIdOnChain) throw new Error("order.confirmed missing orderIdOnChain");
        const buyer = canonicalWallet(event.actorAddress);
        const seller = canonicalWallet(event.secondaryAddress);
        const existing = await tx.order.findUnique({ where: { orderIdOnChain: event.orderIdOnChain } });
        if (existing) {
          await tx.order.update({
            where: { orderIdOnChain: event.orderIdOnChain },
            data: { status: "COMPLETED", needsBackfill: false } as any,
          });
          return;
        }
        await tx.order.create({
          data: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: buyer,
            sellerAddress: seller,
            amount: "0",
            token: "",
            status: "COMPLETED",
            needsBackfill: true,
          } as any,
        });
        return;
      }
      case "order.refunded": {
        if (!event.orderIdOnChain) throw new Error("order.refunded missing orderIdOnChain");
        const buyer = canonicalWallet(event.actorAddress);
        // seller not in event — keep null, not empty string
        const existing = await tx.order.findUnique({ where: { orderIdOnChain: event.orderIdOnChain } });
        if (existing) {
          await tx.order.update({
            where: { orderIdOnChain: event.orderIdOnChain },
            data: { status: "REFUNDED", needsBackfill: false } as any,
          });
          return;
        }
        await tx.order.create({
          data: {
            orderIdOnChain: event.orderIdOnChain ?? "",
            buyerAddress: buyer,
            sellerAddress: null,
            amount: "0",
            token: "",
            status: "REFUNDED",
            needsBackfill: true,
          } as any,
        });
        return;
      }
      default:
        return;
    }
  }
}
