import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('server/Dockerfile HEALTHCHECK (Issue #1424)', () => {
  const dockerfilePath = resolve(import.meta.dirname, '../Dockerfile');
  const dockerfile = readFileSync(dockerfilePath, 'utf8');

  it('does not mask wget exit code 1 with test $? -le 1', () => {
    expect(dockerfile).not.toMatch(/test\s+\$\?\s+-le\s+1/);
  });

  it('uses ${PORT:-5000}/health and fails explicitly with || exit 1', () => {
    expect(dockerfile).toContain('ENV PORT=5000');
    expect(dockerfile).toMatch(
      /HEALTHCHECK[^\n]*\\\s*\r?\n\s*CMD\s+wget\s+--timeout=5\s+-q\s+--spider\s+"http:\/\/localhost:\$\{PORT:-5000\}\/health"\s+\|\|\s+exit\s+1/
    );
  });
});
