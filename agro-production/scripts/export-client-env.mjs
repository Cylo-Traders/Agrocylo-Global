#!/usr/bin/env node
/**
 * Print shell exports that map server-side contract/RPC env vars to the
 * NEXT_PUBLIC_* names consumed by the Next.js client.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/export-client-env.mjs > .client-env.sh
 *   source .client-env.sh
 */

const mappings = [
  ['RPC_URL', 'NEXT_PUBLIC_SOROBAN_RPC_URL'],
  ['PRODUCTION_CONTRACT_ID', 'NEXT_PUBLIC_PRODUCTION_CONTRACT_ID'],
];

const defaults = new Map([
  ['NEXT_PUBLIC_API_URL', 'http://localhost:5001/api/v1'],
  ['NEXT_PUBLIC_WS_URL', 'ws://localhost:5001/ws'],
  ['NEXT_PUBLIC_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015'],
]);

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\''")}'`;
}

for (const [serverName, clientName] of mappings) {
  const value = process.env[serverName];
  if (value) {
    console.log(`export ${clientName}=${shellQuote(value)}`);
  }
}

for (const [clientName, defaultValue] of defaults) {
  const value = process.env[clientName] ?? defaultValue;
  console.log(`export ${clientName}=${shellQuote(value)}`);
}
