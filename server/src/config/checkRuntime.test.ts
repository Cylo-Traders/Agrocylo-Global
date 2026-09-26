import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

// Vitest runs with server/ as the working directory, which is where the
// guard script that preinstall/predev/prebuild invoke lives.
const require = createRequire(path.join(process.cwd(), 'noop.js'));

const { isSupportedNode, isSupportedNpm, parseVersion, validateToolchain } = require(
  path.join(process.cwd(), 'scripts/check-runtime.cjs')
) as {
  isSupportedNode: (version: string) => boolean;
  isSupportedNpm: (version: string) => boolean;
  parseVersion: (version: string) => number[] | undefined;
  validateToolchain: (node: string, npm: string) => string[];
};

const NODE_RANGE = '>=22.13.0 <23';
const NPM_RANGE = '>=10.9.0 <11';

describe('server toolchain guard', () => {
  it('accepts the pinned Node.js and npm releases', () => {
    expect(isSupportedNode('22.13.0')).toBe(true);
    expect(isSupportedNode('v22.20.1')).toBe(true);
    expect(isSupportedNpm('10.9.2')).toBe(true);
    expect(validateToolchain('22.13.0', '10.9.2')).toEqual([]);
  });

  it('rejects the Node majors the locked Prisma client refuses', () => {
    // Prisma Client 7.10.0 declares ^20.19 || ^22.12 || >=24.0, so a broad
    // ">=22" claim would wrongly admit these.
    expect(isSupportedNode('20.19.0')).toBe(false);
    expect(isSupportedNode('24.0.0')).toBe(false);
  });

  it('rejects too-old minors inside the supported major', () => {
    expect(isSupportedNode('22.12.0')).toBe(false);
    expect(isSupportedNode('22.0.0')).toBe(false);
    expect(isSupportedNpm('10.8.0')).toBe(false);
    expect(isSupportedNpm('11.0.0')).toBe(false);
  });

  it('reports an actionable required-version message', () => {
    const errors = validateToolchain('20.19.0', '11.0.0');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(NODE_RANGE);
    expect(errors[0]).toContain('nvm use');
    expect(errors[0]).toContain('server/');
    expect(errors[1]).toContain(NPM_RANGE);
  });

  it('ignores unparseable versions instead of crashing', () => {
    expect(parseVersion('not-a-version')).toBeUndefined();
    expect(isSupportedNode('not-a-version')).toBe(false);
    expect(isSupportedNpm('')).toBe(false);
  });
});
