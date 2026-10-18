/** API routes are mounted under /api/v1. Configure the host at build time. */
export function apiBaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("Set NEXT_PUBLIC_API_URL using agro-production/client/.env.example before building or starting the client.");
  }
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/api/v1') {
    throw new Error("NEXT_PUBLIC_API_URL must be an HTTP(S) URL ending in /api/v1, without credentials, query or fragment.");
  }
  return value.replace(/\/$/, '');
}
