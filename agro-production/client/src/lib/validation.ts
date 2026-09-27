import type { ProductCategory } from "@/types";

const STELLAR_PUBKEY_RE = /^G[A-Z0-9]{55}$/;
const XSS_RE = /<[^>]*>|javascript:|on\w+\s*=|alert\(|confirm\(|prompt\(/gi;

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; sanitized: string }
  | { valid: false; error: string };

/** Stellar's native asset uses seven decimal places (one XLM = 10,000,000 stroops). */
export const STROOPS_PER_XLM = 10_000_000n;

/** Largest signed integer accepted by Soroban's `i128` token amount arguments. */
export const MAX_I128 = (1n << 127n) - 1n;

export type StroopAmountResult =
  | { valid: true; sanitized: string; stroops: bigint }
  | { valid: false; error: string };

// Decimal-only input deliberately excludes scientific notation, signs, and
// leading zeroes. JavaScript's Number/parseFloat accept all of these and can
// silently round the value before it reaches an on-chain i128 argument.
const XLM_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

/**
 * Convert an XLM decimal string to stroops without using floating-point math.
 *
 * Inputs are intentionally strict because this is used before an amount is
 * signed. The returned `sanitized` value is the exact user-entered decimal
 * representation and `stroops` is safe to pass to Soroban i128 parameters.
 */
export function parseXlmToStroops(input: string): StroopAmountResult {
  if (!input || !input.trim()) {
    return { valid: false, error: "Amount is required" };
  }

  if (input !== input.trim() || !XLM_DECIMAL_RE.test(input)) {
    return {
      valid: false,
      error: "Enter a positive XLM amount with up to 7 decimal places",
    };
  }

  const [wholePart, fractionalPart = ""] = input.split(".");
  const stroops =
    BigInt(wholePart) * STROOPS_PER_XLM +
    BigInt(fractionalPart.padEnd(7, "0") || "0");

  if (stroops <= 0n) {
    return { valid: false, error: "Amount must be greater than 0" };
  }

  if (stroops > MAX_I128) {
    return { valid: false, error: "Amount exceeds the supported token limit" };
  }

  return { valid: true, sanitized: input, stroops };
}

/**
 * Format a stroop (i128 base-unit) amount as an exact XLM decimal string.
 *
 * BigInt division only — never `Number(stroops) / 1e7`, which is silently wrong
 * above 2^53 stroops (~900M XLM) and lossy below it. Output is canonical (no
 * grouping, no leading zeros, trailing fractional zeros trimmed) so that
 * `parseXlmToStroops(formatStroops(x)).stroops === x` for every valid i128 `x`.
 */
export function formatStroops(value: bigint | string): string {
  const stroops = typeof value === "bigint" ? value : BigInt(value || "0");
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = (abs % STROOPS_PER_XLM)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Format a stroop amount for human display: exact BigInt whole part with
 * thousands separators, fractional part truncated (never rounded up, so a
 * balance is never overstated) to `fractionDigits`. Display only — not
 * round-trip safe. Use {@link formatStroops} when exactness matters.
 */
export function formatStroopsForDisplay(
  value: bigint | string,
  fractionDigits = 2,
): string {
  const stroops = typeof value === "bigint" ? value : BigInt(value || "0");
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = (abs / STROOPS_PER_XLM)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % STROOPS_PER_XLM).toString().padStart(7, "0");
  const shown = fractionDigits > 0 ? `.${frac.slice(0, fractionDigits)}` : "";
  return `${negative ? "-" : ""}${whole}${shown}`;
}

/** Validate an XLM input while preserving the legacy validation result shape. */
export function validateXlmAmount(input: string): ValidationResult {
  const parsed = parseXlmToStroops(input);
  return parsed.valid
    ? { valid: true, sanitized: parsed.sanitized }
    : { valid: false, error: parsed.error };
}

export function sanitizeString(input: string): string {
  return input.replace(XSS_RE, "").trim();
}

export function validateStellarAddress(address: string): ValidationResult {
  const sanitized = sanitizeString(address);
  if (!sanitized) return { valid: false, error: "Address is required" };
  if (!STELLAR_PUBKEY_RE.test(sanitized))
    return { valid: false, error: "Invalid Stellar public key format" };
  return { valid: true, sanitized };
}

export function validateAmount(
  input: string,
  min = 0,
  max = Infinity,
): ValidationResult {
  const sanitized = sanitizeString(input);
  if (!sanitized) return { valid: false, error: "Amount is required" };
  const num = Number(sanitized);
  if (isNaN(num) || !isFinite(num))
    return { valid: false, error: "Amount must be a valid number" };
  if (num <= min) return { valid: false, error: `Amount must be greater than ${min}` };
  if (num > max) return { valid: false, error: `Amount must not exceed ${max}` };
  return { valid: true, sanitized };
}

export function validateQuantity(
  input: string,
  min = 1,
  max = 999999,
): ValidationResult {
  const sanitized = sanitizeString(input);
  if (!sanitized) return { valid: false, error: "Quantity is required" };
  const num = Number(sanitized);
  if (!Number.isInteger(num) || num < min)
    return { valid: false, error: `Quantity must be at least ${min}` };
  if (num > max)
    return { valid: false, error: `Quantity must not exceed ${max}` };
  return { valid: true, sanitized: String(num) };
}

export function validateOptionalNumber(
  input: string,
  label: string,
): ValidationResult {
  const sanitized = sanitizeString(input);
  if (!sanitized) return { valid: true, sanitized: "" };
  const num = Number(sanitized);
  if (isNaN(num) || !isFinite(num) || num < 0)
    return { valid: false, error: `${label} must be a valid non-negative number` };
  return { valid: true, sanitized };
}

export function validateProductFilters(filters: {
  category?: ProductCategory | "";
  location?: string;
  minPrice?: string;
  maxPrice?: string;
}): { valid: boolean; sanitized: typeof filters; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const sanitized: typeof filters = { ...filters };

  if (filters.location) {
    sanitized.location = sanitizeString(filters.location);
  }

  if (filters.minPrice) {
    const result = validateOptionalNumber(filters.minPrice, "Min price");
    if (!result.valid) {
      errors.push({ field: "minPrice", message: result.error });
    } else {
      sanitized.minPrice = result.sanitized;
    }
  }

  if (filters.maxPrice) {
    const result = validateOptionalNumber(filters.maxPrice, "Max price");
    if (!result.valid) {
      errors.push({ field: "maxPrice", message: result.error });
    } else {
      sanitized.maxPrice = result.sanitized;
    }
  }

  if (
    sanitized.minPrice &&
    sanitized.maxPrice &&
    Number(sanitized.minPrice) > Number(sanitized.maxPrice)
  ) {
    errors.push({
      field: "maxPrice",
      message: "Max price must be greater than or equal to min price",
    });
  }

  return { valid: errors.length === 0, sanitized, errors };
}

export function validateCheckoutInput(input: {
  amountXlm: string;
}): ValidationResult {
  return validateXlmAmount(input.amountXlm);
}

export function validateCampaignTimestamps(deadline: string): ValidationResult {
  const sanitized = sanitizeString(deadline);
  if (!sanitized) return { valid: false, error: "Deadline is required" };
  const ts = Date.parse(sanitized);
  if (isNaN(ts)) return { valid: false, error: "Invalid date format" };
  return { valid: true, sanitized };
}

export function validateOrderData(data: {
  buyerAddress: string;
  campaignId: string;
  amount: string;
}): { valid: boolean; sanitized: typeof data; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const sanitized = { ...data };

  const addrResult = validateStellarAddress(data.buyerAddress);
  if (!addrResult.valid) {
    errors.push({ field: "buyerAddress", message: addrResult.error });
  } else {
    sanitized.buyerAddress = addrResult.sanitized;
  }

  if (!data.campaignId || !sanitizeString(data.campaignId)) {
    errors.push({ field: "campaignId", message: "Campaign ID is required" });
  } else {
    sanitized.campaignId = sanitizeString(data.campaignId);
  }

  const amtResult = validateAmount(data.amount, 0);
  if (!amtResult.valid) {
    errors.push({ field: "amount", message: amtResult.error });
  } else {
    sanitized.amount = amtResult.sanitized;
  }

  return { valid: errors.length === 0, sanitized, errors };
}

export function safePercentage(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  const result = (numerator / denominator) * 100;
  return Number.isFinite(result) ? Math.min(Math.max(result, 0), 100) : 0;
}
