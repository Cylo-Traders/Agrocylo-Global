import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  formatStroops,
  formatStroopsForDisplay,
  parseXlmToStroops,
  MAX_I128,
  STROOPS_PER_XLM,
} from "../lib/validation";

function randomStroops(): bigint {
  let v = 0n;
  for (let i = 0; i < 16; i++) {
    v = (v << 8n) | BigInt(Math.floor(Math.random() * 256));
  }
  return 1n + (v % MAX_I128);
}

describe("formatStroops — exact i128 formatting", () => {
  it("round-trips format(parse(x)) exactly for random i128 values", () => {
    for (let i = 0; i < 500; i++) {
      const x = randomStroops();
      const formatted = formatStroops(x);
      const parsed = parseXlmToStroops(formatted);
      expect(parsed.valid).toBe(true);
      if (parsed.valid) expect(parsed.stroops).toBe(x);
    }
  });

  it("is exact for values above 2^53 stroops where doubles fail", () => {
    // 1,000,000,000.0000001 XLM. 1e16 + 1 stroops > 2^53, so Number() rounds it.
    const stroops = 1_000_000_000n * STROOPS_PER_XLM + 1n;
    expect(stroops).toBeGreaterThan(2n ** 53n);
    expect(formatStroops(stroops)).toBe("1000000000.0000001");

    // The old float path silently rounds the last stroop away.
    // eslint-disable-next-line no-restricted-syntax
    const viaFloat = (Number(stroops) / 1e7).toString();
    expect(viaFloat).toBe("1000000000");
    expect(viaFloat).not.toBe("1000000000.0000001");
  });

  it("handles the maximum i128 without overflow", () => {
    const formatted = formatStroops(MAX_I128);
    const parsed = parseXlmToStroops(formatted);
    expect(parsed.valid).toBe(true);
    if (parsed.valid) expect(parsed.stroops).toBe(MAX_I128);
  });

  it("formats sub-XLM and whole amounts canonically", () => {
    expect(formatStroops(0n)).toBe("0");
    expect(formatStroops(1n)).toBe("0.0000001");
    expect(formatStroops(STROOPS_PER_XLM)).toBe("1");
    expect(formatStroops(12_345_678n)).toBe("1.2345678");
    expect(formatStroops(-STROOPS_PER_XLM)).toBe("-1");
  });
});

describe("formatStroopsForDisplay", () => {
  it("groups thousands and truncates without rounding up", () => {
    expect(formatStroopsForDisplay(1_234_567n * STROOPS_PER_XLM, 2)).toBe(
      "1,234,567.00",
    );
    // 9.999 XLM must not display as 10.00
    expect(formatStroopsForDisplay(99_990_000n, 2)).toBe("9.99");
  });

  it("displayed totals match the exact on-chain sum", () => {
    const investments = ["12500000", "7500000", "1"]; // stroops
    const total = investments.reduce((s, a) => s + BigInt(a), 0n);
    expect(total).toBe(20_000_001n);
    expect(formatStroops(total)).toBe("2.0000001");
    expect(formatStroopsForDisplay(total, 7)).toBe("2.0000001");
  });
});

describe("CI guard: no float conversion of i128 amounts", () => {
  const SRC = join(__dirname, "..");
  const BANNED = [
    { re: /\/\s*1[eE]7\b/, name: "division by 1e7" },
    {
      re: /Number\([^)]*\b(amount|raised|stroops|contribution|revenue|tranche|claimable)\b/i,
      name: "Number() on an amount field",
    },
  ];
  // A line may opt out with a trailing `// amount-exact-ok` when the math is
  // provably exact (e.g. BigInt division that yields a small integer).
  const OPT_OUT = /amount-exact-ok/;

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__") return [];
        return walk(full);
      }
      return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)
        ? [full]
        : [];
    });
  }

  it("no source file divides a chain amount by 1e7 or floats it through Number()", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
      if (rel === "lib/validation.ts") continue; // defines the docblock + formatters
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (OPT_OUT.test(line) || line.trimStart().startsWith("*")) return;
          for (const { re, name } of BANNED) {
            if (re.test(line)) offenders.push(`${rel}:${i + 1}: ${name}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
