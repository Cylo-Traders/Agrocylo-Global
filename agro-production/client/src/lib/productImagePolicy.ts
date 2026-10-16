export function getAllowedProductImageOrigins(): string[] {
  return (process.env.NEXT_PUBLIC_PRODUCT_IMAGE_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .filter((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "https:" || (parsed.protocol === "http:" && parsed.hostname === "localhost");
    } catch {
      return false;
    }
    });
}

export function getAllowedProductImageHosts(): string[] {
  return getAllowedProductImageOrigins().map((origin) => new URL(origin).hostname);
}

export function isAllowedProductImageUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return getAllowedProductImageOrigins().some((origin) => {
      const configured = new URL(origin);
      return url.protocol === configured.protocol && url.origin === configured.origin;
    });
  } catch {
    return false;
  }
}
