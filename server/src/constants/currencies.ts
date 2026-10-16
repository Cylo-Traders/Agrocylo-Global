import { ApiError } from '../http/errors.js';

export interface CurrencyMeta {
  code: string;
  /** Decimal places of the on-chain base unit (XLM stroops = 7). */
  decimals: number;
  chain: 'stellar' | 'starknet';
  /** Legacy currencies are still readable but rejected on new writes. */
  legacy: boolean;
}

/** Single source of truth for supported currencies (#1135). */
export const SUPPORTED_CURRENCIES: Readonly<Record<string, CurrencyMeta>> = {
  XLM: { code: 'XLM', decimals: 7, chain: 'stellar', legacy: false },
  USDC: { code: 'USDC', decimals: 7, chain: 'stellar', legacy: false },
  STRK: { code: 'STRK', decimals: 18, chain: 'starknet', legacy: true },
};

export type CurrencyCode = keyof typeof SUPPORTED_CURRENCIES;

/** Currencies accepted for new listings/demand/supply. */
export const ACTIVE_CURRENCIES = Object.values(SUPPORTED_CURRENCIES)
  .filter((c) => !c.legacy)
  .map((c) => c.code);

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(SUPPORTED_CURRENCIES, value);
}

/** Validates a currency for a write; throws a 400 otherwise. Returns the canonical code. */
export function assertCurrency(value: unknown, { allowLegacy = false } = {}): CurrencyCode {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : value;
  if (!isSupportedCurrency(code) || (!allowLegacy && SUPPORTED_CURRENCIES[code]!.legacy)) {
    throw new ApiError(
      400,
      'Bad Request',
      `Unsupported currency. Supported: ${ACTIVE_CURRENCIES.join(', ')}`,
      'https://cylos.io/errors/validation',
    );
  }
  return code;
}

/** Converts a decimal string (e.g. "1.5") to base units (e.g. stroops) as a bigint. */
export function toBaseUnits(amount: string, currency: CurrencyCode): bigint {
  const { decimals } = SUPPORTED_CURRENCIES[currency]!;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) {
    throw new ApiError(400, 'Bad Request', 'Invalid amount', 'https://cylos.io/errors/validation');
  }
  const [, whole, frac = ''] = match;
  if (frac.length > decimals) {
    throw new ApiError(
      400,
      'Bad Request',
      `${currency} supports at most ${decimals} decimal places`,
      'https://cylos.io/errors/validation',
    );
  }
  return BigInt(whole! + frac.padEnd(decimals, '0'));
}

/** Converts base units back to a decimal string with trailing zeros trimmed. */
export function fromBaseUnits(units: bigint, currency: CurrencyCode): string {
  const { decimals } = SUPPORTED_CURRENCIES[currency]!;
  const s = units.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
