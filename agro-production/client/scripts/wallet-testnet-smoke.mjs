#!/usr/bin/env node
/**
 * Testnet wallet smoke test (multi-wallet migration).
 *
 * Signs and submits one harmless contract invocation with two *different*
 * wallet families, proving the Stellar Wallets Kit abstraction holds end to
 * end: `init` → `setWallet` → `getAddress`/`fetchAddress` → `signTransaction`
 * → submit → confirm on ledger.
 *
 * Why local signer modules instead of the shipped providers: the extension and
 * mobile providers the kit ships (Freighter, xBull, Albedo, Rabet, Hana, LOBSTR,
 * WalletConnect) need an injected browser API and cannot run headless. This
 * script therefore drives the *kit's own* static API with two distinct
 * `ModuleInterface` implementations that sign for real with funded testnet
 * keys — one modelled on a browser extension (grants access once, then honours
 * `skipRequestAccess`), one on a mobile deep-link wallet (re-authorises every
 * time, reports the network per request). Browser-level provider behaviour is
 * covered by `e2e/wallet-picker.spec.ts`, and the app's `WalletAdapter`
 * boundary by `src/__tests__/walletAdapters.test.ts`.
 *
 * Secrets are read from the environment only, either exported by the caller or
 * loaded from a git-ignored `.env.testnet` in this directory. Nothing prints a
 * private key or a full signed XDR — only public keys, the transaction hash, a
 * truncated XDR prefix, and the ledger.
 *
 * Usage:
 *   cp .env.testnet.example .env.testnet   # then fill in funded testnet keys
 *   node scripts/wallet-testnet-smoke.mjs
 *
 * Or pass everything inline; explicit environment variables always win:
 *   STELLAR_TESTNET_SECRET_1=S...  STELLAR_TESTNET_PUBLIC_1=G...
 *   STELLAR_TESTNET_SECRET_2=S...  STELLAR_TESTNET_PUBLIC_2=G...
 *   SMOKE_CONTRACT_ID=C...         SMOKE_FUNCTION_NAME=ping
 *   node scripts/wallet-testnet-smoke.mjs
 *
 * SMOKE_FUNCTION_NAME must name a harmless, idempotent, argument-free method on
 * the target contract (for example a `ping()` on a scratch testnet deployment).
 * SMOKE_FUNCTION_ARGS accepts a JSON array (default `[]`).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { ModuleType } from "@creit.tech/stellar-wallets-kit/types";

// `process.loadEnvFile` is built in on Node 22 and, like `--env-file`, never
// overwrites a variable that is already exported. It throws ENOENT when the
// file is absent, which is the inline-environment-variable path.
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.testnet");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
  console.log(`Loaded testnet inputs from ${envFile}`);
}

const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL =
  process.env.SOROBAN_TESTNET_RPC_URL?.trim() ||
  "https://soroban-testnet.stellar.org/stellar/rpc";
const TIMEOUT_SECONDS = 60;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. See docs/WALLETS.md and fund both accounts on testnet.`,
    );
  }
  return value;
}

function keypair(secretName, publicName) {
  const secret = required(secretName);
  const publicKey = required(publicName);
  const pair = Keypair.fromSecret(secret);
  if (pair.publicKey() !== publicKey) {
    throw new Error(`${publicName} does not match the account derived from ${secretName}.`);
  }
  return pair;
}

function truncateXdr(xdr) {
  return xdr.length <= 24 ? xdr : `${xdr.slice(0, 24)}…(${xdr.length} chars)`;
}

function signLocally(pair, xdr, networkPassphrase) {
  const transaction = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  transaction.sign(pair, networkPassphrase ?? NETWORK_PASSPHRASE);
  return { signedTxXdr: transaction.toXDR(), signerAddress: pair.publicKey() };
}

/** Browser-extension family: grants access once, then skips the prompt. */
function createExtensionModule(productId, productName, pair, productUrl) {
  let granted = false;
  return {
    moduleType: ModuleType.HOT_WALLET,
    productId,
    productName,
    productUrl,
    productIcon: "",
    async isAvailable() {
      return true;
    },
    async getAddress(params) {
      if (granted && params?.skipRequestAccess) return { address: pair.publicKey() };
      granted = true;
      return { address: pair.publicKey() };
    },
    async signTransaction(xdr, opts) {
      return signLocally(pair, xdr, opts?.networkPassphrase);
    },
    async signAuthEntry() {
      throw new Error("signAuthEntry is not exercised by this smoke test");
    },
    async signMessage() {
      throw new Error("signMessage is not exercised by this smoke test");
    },
    async getNetwork() {
      return { network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASE };
    },
  };
}

/** Mobile deep-link family: no persisted grant, network reported per request. */
function createMobileModule(productId, productName, pair, productUrl) {
  return {
    moduleType: ModuleType.BRIDGE_WALLET,
    productId,
    productName,
    productUrl,
    productIcon: "",
    async isAvailable() {
      return true;
    },
    async getAddress() {
      return { address: pair.publicKey() };
    },
    async signTransaction(xdr, opts) {
      return signLocally(pair, xdr, opts?.networkPassphrase);
    },
    async signAuthEntry() {
      throw new Error("signAuthEntry is not exercised by this smoke test");
    },
    async signMessage() {
      throw new Error("signMessage is not exercised by this smoke test");
    },
    async getNetwork() {
      return { network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASE };
    },
  };
}

async function submitOnce({ server, walletModule, pair, contract, functionName, args, label }) {
  StellarWalletsKit.setWallet(walletModule.productId);

  // `fetchAddress` asks the provider and primes the kit's in-memory address;
  // `getAddress` then reads it back without touching the wallet again.
  const fetched = await StellarWalletsKit.fetchAddress();
  const cached = await StellarWalletsKit.getAddress();
  if (fetched.address !== pair.publicKey() || cached.address !== pair.publicKey()) {
    throw new Error(`${label} returned the wrong address`);
  }

  const account = await server.getAccount(pair.publicKey());
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.invoke(functionName, ...args))
    .setTimeout(TIMEOUT_SECONDS)
    .build();

  const prepared = await server.prepareTransaction(built);
  const { signedTxXdr, signerAddress } = await StellarWalletsKit.signTransaction(
    prepared.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE, address: pair.publicKey() },
  );
  if (!signedTxXdr) throw new Error(`${label} returned an empty signed XDR`);

  const response = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE),
  );
  if (!response.hash) {
    throw new Error(
      `${label} submission was rejected: ${response.status} ${JSON.stringify(
        response.errorResult ?? response,
      )}`,
    );
  }

  const settled = await server.pollTransaction(response.hash);
  if (settled.status !== "SUCCESS") {
    throw new Error(
      `${label} did not succeed on testnet: ${settled.status} ${JSON.stringify(
        settled.resultXdr ?? settled,
      )}`,
    );
  }

  console.log(`  ${label}`);
  console.log(`    address     ${pair.publicKey()}`);
  console.log(`    signer      ${signerAddress}`);
  console.log(`    signed XDR  ${truncateXdr(signedTxXdr)}`);
  console.log(`    hash        ${response.hash}`);
  console.log(`    status      ${settled.status} (ledger ${settled.ledger})`);

  return response.hash;
}

async function main() {
  const contractId = required("SMOKE_CONTRACT_ID");
  const functionName = process.env.SMOKE_FUNCTION_NAME?.trim() || "ping";
  const args = JSON.parse(process.env.SMOKE_FUNCTION_ARGS?.trim() || "[]");
  if (!Array.isArray(args)) {
    throw new Error("SMOKE_FUNCTION_ARGS must be a JSON array.");
  }

  const extensionPair = keypair("STELLAR_TESTNET_SECRET_1", "STELLAR_TESTNET_PUBLIC_1");
  const mobilePair = keypair("STELLAR_TESTNET_SECRET_2", "STELLAR_TESTNET_PUBLIC_2");
  if (extensionPair.publicKey() === mobilePair.publicKey()) {
    throw new Error(
      "Both smoke accounts are the same. Use two funded testnet accounts so the two wallet families stay distinct.",
    );
  }

  const hashes = [];
  const families = [
    [createExtensionModule("smoke-extension", "Smoke Extension", extensionPair, "https://example.invalid/extension"), extensionPair],
    [createMobileModule("smoke-mobile", "Smoke Mobile", mobilePair, "https://example.invalid/mobile"), mobilePair],
  ];

  StellarWalletsKit.init({ modules: families.map(([walletModule]) => walletModule), network: NETWORK_PASSPHRASE });

  const server = new Server(RPC_URL);
  const contract = new Contract(contractId);

  console.log(
    `Harmless invocation ${contractId}.${functionName}(${args.length} arg(s)) on testnet via ${RPC_URL}`,
  );

  for (const [walletModule, pair] of families) {
    hashes.push(
      await submitOnce({
        server,
        walletModule,
        pair,
        contract,
        functionName,
        args,
        label: `${walletModule.productName} (${walletModule.moduleType})`,
      }),
    );
  }

  console.log("\nBoth wallet families signed and submitted successfully:");
  for (const hash of hashes) console.log(`  ${hash}`);
}

main().catch((error) => {
  console.error("Wallet testnet smoke test failed:", error?.message ?? error);
  process.exit(1);
});
