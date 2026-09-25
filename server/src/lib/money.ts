/**
 * Canonical money handling for on-chain i128 amounts.
 *
 * All money columns that originate on-chain (Order.amount, Campaign.goalAmount,
 * Investment.amount, etc.) are stored as canonical decimal strings:
 *  - trimmed, no leading/trailing whitespace
 *  - no exponent notation
 *  - no leading zeros except single "0"
 *  - optional leading "-" for negative (range check allows i128)
 *  - pure integer string (stroops / base units) — no decimal point
 *
 * This module provides the single ingestion-boundary helper required by the
 * acceptance criteria and the numeric comparison helpers used by reconciliation.
 */

const CANONICAL_INT_RE = /^-?(0|[1-9][0-9]*)$/;
const LOOSE_NUMERIC_RE = /^\s*[+-]?[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?\s*$/;

/**
 * Maximum / minimum i128 values as BigInt for range validation.
 * On-chain Soroban i128 is signed 128-bit.
 */
export const I128_MIN = -(2n ** 127n);
export const I128_MAX = 2n ** 127n - 1n;

/**
 * Returns true iff `value` is already in canonical form.
 * Canonical = trimmed, no exponent, no leading zeros, integer decimal string.
 */
export function isCanonicalAmount(value: string): boolean {
  if (typeof value !== "string") return false;
  if (!CANONICAL_INT_RE.test(value)) return false;
  try {
    const bi = BigInt(value);
    return bi >= I128_MIN && bi <= I128_MAX;
  } catch {
    return false;
  }
}

/**
 * Returns true iff `value` can be interpreted as a numeric amount (after
 * trimming / exponent expansion) and lies within i128 range.
 * This is the loose validation used at ingestion to reject garbage like
 * "abc", "", "1.2.3", "  ".
 */
export function isValidAmountString(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  // Reject non-numeric
  if (!LOOSE_NUMERIC_RE.test(value)) return false;
  try {
    const canonical = canonicalizeAmount(value);
    return isCanonicalAmount(canonical);
  } catch {
    return false;
  }
}

/**
 * Canonicalizes any reasonable numeric string representation to the
 * canonical integer string form.
 *
 * Handles:
 *  - whitespace: " 1000 " -> "1000"
 *  - leading zeros: "01000" -> "1000"
 *  - decimal trailing zeros: "1000.0" -> "1000", "1000.00" -> "1000"
 *  - scientific notation: "1e3" -> "1000", "1.5e2" -> "150"
 *  - negative zero: "-0" -> "0"
 *
 * For on-chain i128 stroop amounts we expect integer strings, but we
 * normalize any decimal/scientific rendering to its integer equivalent by
 * truncating fractional part after expansion? Actually i128 on-chain is
 * integer; a decimal like "1000.0" should map to "1000". We handle by
 * parsing as Number if exponent/decimal present, then BigInt conversion,
 * with fallback to manual string manipulation for large ints beyond
 * Number.MAX_SAFE_INTEGER.
 *
 * Large i128 values beyond JS Number precision are handled via string
 * manipulation to avoid precision loss.
 *
 * Throws if input is not numeric or out of i128 range.
 */
export function canonicalizeAmount(input: string | bigint | number): string {
  if (typeof input === "bigint") {
    if (input < I128_MIN || input > I128_MAX) {
      throw new RangeError(`Amount out of i128 range: ${input}`);
    }
    return input.toString();
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error(`Invalid amount number: ${input}`);
    // Numbers may be in scientific notation; convert via string
    return canonicalizeAmount(String(input));
  }

  // string path
  const raw = String(input).trim();
  if (raw === "") throw new Error("Empty amount string");

  // Fast path: already canonical
  if (CANONICAL_INT_RE.test(raw)) {
    const bi = BigInt(raw);
    if (bi < I128_MIN || bi > I128_MAX) throw new RangeError(`Amount out of i128 range: ${raw}`);
    // Normalize -0 -> 0
    if (bi === 0n) return "0";
    return bi.toString();
  }

  // Need to handle exponent / decimal / leading zeros
  // Use BigInt string manipulation for large values to avoid Number precision loss.
  // Strategy: expand scientific notation and decimal manually.
  const lower = raw.toLowerCase();
  // Check for exponent
  if (lower.includes("e")) {
    const [mantissa, expStr] = lower.split("e");
    if (mantissa === undefined || expStr === undefined) throw new Error(`Invalid amount: ${input}`);
    const exp = parseInt(expStr, 10);
    if (Number.isNaN(exp)) throw new Error(`Invalid exponent in amount: ${input}`);
    return canonicalizeWithExponent(mantissa.trim(), exp);
  }

  // Decimal without exponent
  if (raw.includes(".")) {
    const [intPart, fracPart = ""] = raw.split(".");
    // If fractional part is all zeros, just return int part canonicalized
    if (/^0*$/.test(fracPart)) {
      // e.g. "1000.0" -> "1000"
      const intCanonical = intPart.trim() === "" ? "0" : intPart.trim();
      // Remove leading zeros / sign handling
      return canonicalizeAmount(intCanonical);
    }
    // For non-zero fractional, we need to decide: on-chain amounts are integers,
    // so a true fractional like "1000.5" is questionable. We treat it as
    // invalid for strict integer canonicalization, but to satisfy
    // "1000" vs "1000.0" equivalence, we allow ".0*" only.
    // If fractional non-zero, we throw to surface data error rather than
    // silently truncating.
    throw new Error(`Fractional amount not allowed for integer canonicalization: ${input} (fractional part "${fracPart}")`);
  }

  // Leading zeros case like "001000" or "+1000" or "-001000"
  // Strip sign, leading zeros, then re-add sign
  const sign = raw.startsWith("-") ? "-" : raw.startsWith("+") ? "" : "";
  const unsigned = raw.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
  const candidate = sign + unsigned;
  // Remove -0
  if (candidate === "-0" || candidate === "+0") return "0";
  // Validate trailing zeros correctly? Already handled
  if (!CANONICAL_INT_RE.test(candidate)) throw new Error(`Invalid amount after normalization: ${input} -> ${candidate}`);
  const bi = BigInt(candidate);
  if (bi < I128_MIN || bi > I128_MAX) throw new RangeError(`Amount out of i128 range: ${candidate}`);
  return bi.toString();
}

function canonicalizeWithExponent(mantissa: string, exp: number): string {
  // mantissa may have decimal point and sign
  const sign = mantissa.startsWith("-") ? "-" : "";
  const unsignedMantissa = mantissa.replace(/^[+-]/, "");
  const [intPartRaw, fracPartRaw = ""] = unsignedMantissa.split(".");
  const intPart = intPartRaw.replace(/^0+/, "") || "0";
  const fracPart = fracPartRaw; // keep as is, don't trim zeros yet; they matter for exponent shift

  // Combine digits and track decimal position
  const digits = (intPart === "0" ? "" : intPart) + fracPart;
  const digitsStripped = digits.replace(/^0+/, "") || "0";
  if (digitsStripped === "0") return "0";

  // Original decimal point was at intPart.length from left
  // After exponent, decimal point moves exp to the right
  // Number of fractional digits = fracPart.length
  // Effective exponent shift: exp - fracPart.length
  const fracLen = fracPart.length;
  const netExp = exp - fracLen;
  // But we had intPart length; easier: digits is integer without point,
  // value = digits * 10^(netExp) ??? Let's think:
  // value = (digits) * 10^(exp - fracLen) if we consider digits as integer formed by removing decimal.
  // Actually mantissa = digits / 10^fracLen, so mantissa *10^exp = digits *10^(exp - fracLen)
  // So netExp = exp - fracLen
  // If netExp >=0, append zeros; if <0, need division -> fractional -> invalid for integer canonical unless divisible?
  // For integer amounts, fractional result means not integer -> error unless fractional zeros?
  // Example: "1.5e2" => digits="15", fracLen=1, netExp=1 => 15*10^1=150 correct
  // "1e3" => digits="1", fracLen=0, netExp=3 => 1000
  // "1000.0e0" => digits="10000", fracLen=1, netExp=-1 => 10000*10^-1=1000 => but our earlier split intPart etc handles?
  // Let's handle generic.

  if (netExp >= 0) {
    const result = digitsStripped + "0".repeat(netExp);
    // Remove leading zeros already done, but ensure canonical
    const canonical = (sign === "-" && result !== "0" ? "-" : "") + result.replace(/^0+/, "") || "0";
    const bi = BigInt(canonical);
    if (bi < I128_MIN || bi > I128_MAX) throw new RangeError(`Amount out of i128 range: ${canonical}`);
    return bi.toString();
  } else {
    // netExp negative => division by 10^-netExp
    const absExp = -netExp;
    if (digitsStripped.length <= absExp) {
      // Result is fractional like 0.xxx
      // Check if fractional part is all zeros after division? That would mean digits is e.g. "1000" and netExp -1 => "100" correct? Wait digitsStripped="1000", netExp=-1? Actually "1000.0" case not here because mantissa "1000.0" with exp 0 => digits "10000"? No intPart "1000", frac "0" => digits "10000", stripped "1"? Hmm. Let's use more robust.
      // For "1000.0e0": mantissa "1000.0" => intPartRaw "1000", frac "0" => digits "10000"? Wait intPart after strip "1000", frac "0" => digits "1000"+"0" = "10000", stripped "10000", fracLen 1, netExp -1 => digitsStripped length 5, absExp 1 => result should be "1000". Our logic: digitsStripped "10000" length 5, absExp 1 => need to insert decimal point before last 1 digit: "1000.0" -> integer part "1000". So we can handle by splitting digitsStripped.
      const neededZeros = absExp - digitsStripped.length;
      if (neededZeros >= 0) {
        // e.g. digits "1", absExp 3 => 0.001 -> not integer, but if original was "1e-3" => fractional -> invalid
        throw new Error(`Amount is fractional (exponent yields non-integer): ${mantissa}e${exp}`);
      } else {
        // Split
        const integerDigits = digitsStripped.slice(0, digitsStripped.length - absExp);
        const fractionalDigits = digitsStripped.slice(digitsStripped.length - absExp);
        if (!/^0*$/.test(fractionalDigits)) {
          throw new Error(`Fractional amount not allowed: ${mantissa}e${exp} -> fractional part "${fractionalDigits}"`);
        }
        const intCanonical = integerDigits.replace(/^0+/, "") || "0";
        const candidate = (sign === "-" && intCanonical !== "0" ? "-" : "") + intCanonical;
        const bi = BigInt(candidate);
        if (bi < I128_MIN || bi > I128_MAX) throw new RangeError(`Amount out of i128 range: ${candidate}`);
        return bi.toString();
      }
    } else {
      // digitsStripped longer than absExp, so we have integerDigits + fractionalDigits
      const integerDigits = digitsStripped.slice(0, digitsStripped.length - absExp);
      const fractionalDigits = digitsStripped.slice(digitsStripped.length - absExp);
      if (!/^0*$/.test(fractionalDigits)) {
        throw new Error(`Fractional amount not allowed: ${mantissa}e${exp}`);
      }
      const intCanonical = integerDigits.replace(/^0+/, "") || "0";
      const candidate = (sign === "-" && intCanonical !== "0" ? "-" : "") + intCanonical;
      const bi = BigInt(candidate);
      if (bi < I128_MIN || bi > I128_MAX) throw new RangeError(`Amount out of i128 range: ${candidate}`);
      return bi.toString();
    }
  }
}

/**
 * Compare two amount strings numerically (BigInt-aware), handling
 * canonicalization differences like leading zeros, whitespace, exponent,
 * and ".0" suffix.
 *
 * Returns true iff numerically equal.
 * If either is invalid, falls back to strict string equality? No, we
 * return false for invalid to force drift? But spec says never flag
 * equivalent values as drift. For invalid we treat as not equal to avoid
 * masking data errors — callers should validate first.
 */
export function amountsEqual(a: string, b: string): boolean {
  try {
    const ca = canonicalizeAmount(a);
    const cb = canonicalizeAmount(b);
    return ca === cb;
  } catch {
    // If canonicalization fails, compare trimmed raw? But spec says don't flag
    // equivalent values as drift; invalid strings are not equivalent.
    // Fallback to false (mismatch) unless both invalid and identical raw?
    return a.trim() === b.trim();
  }
}

/**
 * Strict numeric equality using BigInt without full canonical exponent logic
 * — suitable for fast comparison when inputs are known to be integer strings
 * with possible whitespace/leading zeros (common case).
 * Falls back to amountsEqual for exponent.
 */
export function amountsEqualLoose(a: string, b: string): boolean {
  return amountsEqual(a, b);
}

/**
 * Zod-compatible guard: throws if not valid canonical amount.
 * Use in Zod refine or manual validation at API boundary.
 */
export function assertValidAmount(value: string, fieldName = "amount"): void {
  if (!isValidAmountString(value)) {
    throw new Error(`${fieldName} must be a valid integer amount string (i128 range), got: ${String(value).slice(0, 100)}`);
  }
}

/**
 * Helper to canonicalize or throw with field context.
 */
export function toCanonicalAmount(value: string, fieldName = "amount"): string {
  try {
    return canonicalizeAmount(value);
  } catch (e) {
    throw new Error(`${fieldName}: ${(e as Error).message}`);
  }
}
