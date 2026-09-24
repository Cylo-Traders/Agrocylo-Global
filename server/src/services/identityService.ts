import { prisma } from "../config/database.js";
import type { Prisma } from "@prisma/client";

/**
 * Canonical identity helper — single code path for User/Profile creation.
 *
 * Wallet addresses are normalized to lower case for DB lookup/storage to
 * avoid case-sensitivity duplication (G... vs g...). Original case is
 * preserved in JWT but DB is canonical lower-cased.
 *
 * All callers — authService, event indexer, profile creation — should use
 * this helper instead of ad-hoc prisma.user / prisma.profile calls.
 */

function canonicalWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

export class IdentityService {
  /** Ensure a User row exists for walletAddress; idempotent upsert. */
  static async ensureUser(
    walletAddress: string,
    tx?: Prisma.TransactionClient | typeof prisma,
  ): Promise<void> {
    if (!walletAddress || walletAddress.trim() === "") {
      throw new Error("Cannot ensure identity for empty wallet address");
    }
    const canonical = canonicalWallet(walletAddress);
    const client = (tx as any) ?? prisma;
    await client.user.upsert({
      where: { walletAddress: canonical },
      update: {},
      create: { walletAddress: canonical },
    });
  }

  /** Ensure both User and Profile rows exist; optionally set role. */
  static async ensureUserAndProfile(
    walletAddress: string,
    role?: string,
    tx?: Prisma.TransactionClient | typeof prisma,
  ): Promise<void> {
    if (!walletAddress || walletAddress.trim() === "") return;
    const canonical = canonicalWallet(walletAddress);
    const client = (tx as any) ?? prisma;
    await client.user.upsert({
      where: { walletAddress: canonical },
      update: {},
      create: { walletAddress: canonical, role: role ?? null },
    });
    // Profile is 1:1 extension; create if missing
    await client.profile.upsert({
      where: { walletAddress: canonical },
      update: {},
      create: { walletAddress: canonical, role: role ?? "BUYER" },
    });
  }

  /**
   * Batch ensure for event ingestion — upserts users for actor and secondary
   * addresses inside an existing transaction. Skips empty addresses.
   */
  static async ensureUsersForEvent(
    tx: Prisma.TransactionClient | typeof prisma,
    actorAddress?: string,
    secondaryAddress?: string,
  ): Promise<void> {
    const addresses = [actorAddress, secondaryAddress]
      .filter((a): a is string => Boolean(a && a.trim() !== ""));
    for (const addr of addresses) {
      const canonical = canonicalWallet(addr);
      await (tx as any).user.upsert({
        where: { walletAddress: canonical },
        update: {},
        create: { walletAddress: canonical },
      });
      // Also ensure profile exists for marketplace FKs (Product, Cart)
      // but don't override role if already exists
      await (tx as any).profile.upsert({
        where: { walletAddress: canonical },
        update: {},
        create: { walletAddress: canonical },
      });
    }
  }

  /** Lookup identity — returns null if not found */
  static async findUser(walletAddress: string) {
    const canonical = canonicalWallet(walletAddress);
    return prisma.user.findUnique({ where: { walletAddress: canonical } });
  }

  /** Canonicalize wallet for query usage */
  static canonicalize(walletAddress: string): string {
    return canonicalWallet(walletAddress);
  }
}
