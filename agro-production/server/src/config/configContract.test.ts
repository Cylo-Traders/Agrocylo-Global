import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.resolve(__dirname, '..');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('config contract', () => {
  it('fails if a config.<key> reference in src/ has no definition', () => {
    const files = walk(SRC_ROOT);
    // Negative lookbehind excludes things like `vitest.config.ts` (a filename,
    // not a property access on the `config` object).
    const configKeyPattern = /(?<![\w.])config\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const knownKeys = new Set(Object.keys(config));
    const missing = new Set<string>();

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = configKeyPattern.exec(content)) !== null) {
        const key = match[1];
        if (!knownKeys.has(key)) {
          missing.add(`${key} (referenced in ${path.relative(SRC_ROOT, file)})`);
        }
      }
    }

    expect(Array.from(missing)).toEqual([]);
  });

  it('exposes jwtSecret, sentryDsn, sentryTracesSampleRate, basketContractId', () => {
    expect(typeof config.jwtSecret).toBe('string');
    expect(config.jwtSecret.length).toBeGreaterThan(0);
    expect(typeof config.sentryDsn).toBe('string');
    expect(typeof config.sentryTracesSampleRate).toBe('number');
    expect(typeof config.basketContractId).toBe('string');
  });
});
