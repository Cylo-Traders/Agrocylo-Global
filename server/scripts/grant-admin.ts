#!/usr/bin/env tsx
/**
 * Bootstrap / revoke admin role for a Stellar wallet.
 *
 * Usage:
 *   npm run grant-admin -- GABC...               # promote to ADMIN
 *   npm run grant-admin -- GABC... --revoke      # demote to BUYER
 *   npx tsx scripts/grant-admin.ts GABC...
 *
 * Source of truth for admin is:
 *   1. ADMIN_WALLETS env allowlist (checked at login, no DB write needed), OR
 *   2. users.role = 'ADMIN' in the DB (managed by this script).
 *
 * This script writes #2 — it upserts users.role and, if a profile row exists,
 * keeps profile.role in sync so the two sources don't diverge.
 *
 * Requires DATABASE_URL to be set (same as server).
 */
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "../src/config/database.js";

function isStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const revoke = rawArgs.includes("--revoke") || rawArgs.includes("--remove");
  const wallet = rawArgs.find((a) => !a.startsWith("--") && !a.startsWith("-"));

  if (!wallet) {
    console.error("Usage: npm run grant-admin -- <STELLAR_WALLET_ADDRESS> [--revoke]");
    console.error("  Promotes the wallet to ADMIN. With --revoke, demotes to BUYER.");
    process.exit(1);
  }

  if (!isStellarAddress(wallet)) {
    console.error(`Invalid Stellar public key: ${wallet}`);
    process.exit(1);
  }

  const targetRole = revoke ? "BUYER" : "ADMIN";
  const action = revoke ? "Revoking" : "Granting";

  console.log(`${action} ${targetRole} for ${wallet} ...`);

  // Upsert users row — users is the canonical role table checked by authService + requireAdmin
  const user = await prisma.user.upsert({
    where: { walletAddress: wallet },
    update: { role: targetRole },
    create: { walletAddress: wallet, role: targetRole },
  });
  console.log(`  users.role = ${user.role}`);

  // Keep profile.role in sync if a profile exists; do not create a profile here
  try {
    const profile = await prisma.profile.findUnique({ where: { wallet_address: wallet } });
    if (profile) {
      await prisma.profile.update({
        where: { wallet_address: wallet },
        data: { role: targetRole },
      });
      console.log(`  profile.role = ${targetRole} (synced)`);
    } else {
      console.log(`  profile: none (skipped — will default on next profile create)`);
    }
  } catch (e) {
    console.warn("  profile sync failed (non-fatal):", e);
  }

  if (!revoke) {
    console.log("\nDone. This wallet will now receive JWT role: 'ADMIN' on next login.");
    console.log("Existing JWTs remain valid until expiry but requireAdmin cross-checks the DB,");
    console.log("so a demoted admin's old token will be rejected on next admin request.");
    console.log("\nTip: for emergency / bootstrap without a DB write, add the wallet to ADMIN_WALLETS env instead.");
  } else {
    console.log("\nDone. Wallet demoted to BUYER. Any outstanding ADMIN JWTs will be rejected by the DB cross-check.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("grant-admin failed:", err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
