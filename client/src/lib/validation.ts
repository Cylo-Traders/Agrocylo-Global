export function sanitizeString(value: string): string {
  return value.replace(/[<>]/g, "").trim();
}

export function validateStellarAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Wallet address is required.";
  if (!/^G[A-Z0-9]{55}$/i.test(trimmed))
    return "Invalid Stellar address format.";
  return null;
}

export function validatePositiveNumber(
  value: string,
  label = "Value",
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  const num = Number(trimmed);
  if (Number.isNaN(num) || num <= 0) return `${label} must be a positive number.`;
  return null;
}

export function validateDeadline(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Delivery deadline is required.";
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "Invalid date format.";
  if (date <= new Date()) return "Delivery deadline must be in the future.";
  return null;
}

export function validateRequired(value: string, label = "Field"): string | null {
  if (!value.trim()) return `${label} is required.`;
  return null;
}

export function validateMaxLength(
  value: string,
  max: number,
  label = "Field",
): string | null {
  if (value.length > max) return `${label} must be ${max} characters or less.`;
  return null;
}

export function sanitizeAndValidateAmount(
  value: string,
  label = "Amount",
): string | null {
  const sanitized = sanitizeString(value);
  return validatePositiveNumber(sanitized, label);
}
