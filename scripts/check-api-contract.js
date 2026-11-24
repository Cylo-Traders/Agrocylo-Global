#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const specPath = path.join(root, 'server', 'openapi.yaml');
const spec = fs.readFileSync(specPath, 'utf8');

function fail(msg) {
  console.error(`api-contract-check: ${msg}`);
  process.exitCode = 1;
}

const requiredPaths = [
  '/products',
  '/products/{id}',
  '/cart',
  '/cart/items',
  '/cart/items/{id}',
  '/cart/checkout',
];
for (const p of requiredPaths) {
  if (!spec.includes(`${p}:`)) fail(`missing path in server/openapi.yaml: ${p}`);
}

const requiredSnippets = [
  'name: x-wallet-address',
  "'401': { description: Unauthorized }",
];
for (const s of requiredSnippets) {
  if (!spec.includes(s)) fail(`missing contract snippet: ${s}`);
}

const productService = fs.readFileSync(path.join(root, 'client/src/services/productService.ts'), 'utf8');
if (!productService.includes('/products')) fail('client product service missing /products endpoint usage');

const productTest = fs.readFileSync(path.join(root, 'client/src/services/productService.test.ts'), 'utf8');
if (!productTest.includes('listProducts')) fail('missing product service contract/behavior test');

if (!process.exitCode) console.log('api-contract-check: ok');
