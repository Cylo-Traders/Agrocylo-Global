#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'docs', 'label-manifest.json');
const docs = ['CONTRIBUTING.md', 'ARCHITECTURE.md'].map((f) => path.join(root, f));

function fail(msg) {
  console.error(`label-doc-check: ${msg}`);
  process.exitCode = 1;
}

if (!fs.existsSync(manifestPath)) {
  fail(`missing manifest: ${path.relative(root, manifestPath)}`);
  process.exit(process.exitCode || 1);
}

const manifest = JSON.parse(fs.readTextSync ? fs.readTextSync(manifestPath, 'utf8') : fs.readFileSync(manifestPath, 'utf8'));
const allowed = new Set(manifest.labels || []);
const labelPattern = /`([A-Za-z0-9][A-Za-z0-9 :/-]{1,60})`/g;
const knownLabels = new Set(['bug','documentation','duplicate','enhancement','good first issue','help wanted','invalid','question','wontfix','Stellar Wave','Frontend','Backend','Contract','GrantFox OSS','Maybe Rewarded','Official Campaign | FWC26','Third Campaign']);

for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(labelPattern)) {
    const token = m[1];
    if (knownLabels.has(token) && !allowed.has(token)) {
      fail(`${path.relative(root, file)} references undocumented label \`${token}\``);
    }
  }
}

for (const label of allowed) {
  if (!knownLabels.has(label)) {
    fail(`manifest contains label not in repository label set: \`${label}\``);
  }
}

if (!process.exitCode) console.log('label-doc-check: ok');
