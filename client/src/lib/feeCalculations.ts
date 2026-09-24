const STROOPS_PER_XLM = 10_000_000n;
const XLM_CENTS = 100n;
const STROOPS_PER_CENT = STROOPS_PER_XLM / XLM_CENTS;
const PLATFORM_FEE_BPS = 300n;
const BPS_DENOM = 10_000n;
const PLATFORM_FEE_PCT = 3;

function xlmToStroops(xlm: number): bigint {
  if (!Number.isFinite(xlm) || xlm < 0) return 0n;
  const cents = Math.round(xlm * 100);
  return BigInt(cents) * STROOPS_PER_CENT;
}

function feeFromGrossStroops(grossStroops: bigint): bigint {
  return (grossStroops * PLATFORM_FEE_BPS) / BPS_DENOM;
}

function netFromGrossStroops(grossStroops: bigint): bigint {
  return grossStroops - feeFromGrossStroops(grossStroops);
}

function displayFee(grossXlm: number): number {
  return (grossXlm * PLATFORM_FEE_PCT) / 100;
}

function displayNet(grossXlm: number): number {
  return grossXlm - displayFee(grossXlm);
}

const DEFAULT_DECIMALS = 7;
const POW10: Record<number, bigint> = {
  7: 10_000_000n,
};

function pow10(decimals: number): bigint {
  if (POW10[decimals] !== undefined) return POW10[decimals];
  let v = 1n;
  for (let i = 0; i < decimals; i++) v *= 10n;
  POW10[decimals] = v;
  return v;
}

/**
 * Format a minor-unit integer (string or bigint, e.g. "10000000" stroops) into
 * a human-readable major-unit string ("1", "1.25", "0.0000001").
 * Retains exactness via bigint arithmetic; never uses float.
 */
function formatMinorUnits(value: string | bigint, decimals: number = DEFAULT_DECIMALS): string {
  try {
    const bi = typeof value === "bigint" ? value : BigInt(value || "0");
    if (bi === 0n) return "0";
    const negative = bi < 0n;
    const abs = negative ? -bi : bi;
    const base = pow10(decimals);
    const intPart = abs / base;
    const fracPart = abs % base;
    if (fracPart === 0n) return `${negative ? "-" : ""}${intPart.toString()}`;
    let fracStr = fracPart.toString().padStart(decimals, "0");
    // Trim trailing zeros for display, but keep at least one fractional digit if needed
    fracStr = fracStr.replace(/0+$/, "");
    return `${negative ? "-" : ""}${intPart.toString()}.${fracStr}`;
  } catch {
    return "0";
  }
}

/**
 * Convert a display string (e.g. "1.25") to minor units bigint without float.
 */
function toMinorUnits(display: string, decimals: number = DEFAULT_DECIMALS): bigint {
  const [intPart = "0", fracPart = ""] = display.split(".");
  const frac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const base = pow10(decimals);
  const intVal = intPart === "" || intPart === "-" ? "0" : intPart.replace("-", "");
  const isNeg = display.trim().startsWith("-");
  const bi = BigInt(intVal || "0") * base + BigInt(frac || "0");
  return isNeg ? -bi : bi;
}

function formatAmountWithCurrency(value: string | bigint, currency: string, decimals: number = DEFAULT_DECIMALS): string {
  return `${formatMinorUnits(value, decimals)} ${currency}`;
}

export {
  STROOPS_PER_XLM,
  PLATFORM_FEE_BPS,
  BPS_DENOM,
  PLATFORM_FEE_PCT,
  xlmToStroops,
  feeFromGrossStroops,
  netFromGrossStroops,
  displayFee,
  displayNet,
  formatMinorUnits,
  toMinorUnits,
  formatAmountWithCurrency,
  DEFAULT_DECIMALS,
};
