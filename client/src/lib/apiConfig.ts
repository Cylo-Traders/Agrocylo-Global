/**
 * Single source of truth for backend connection configuration.
 *
 * Set NEXT_PUBLIC_API_URL in `.env.local` for both REST and Socket.io.
 * Default is same-origin `/api`; set NEXT_PUBLIC_API_URL for an absolute backend URL.
 */
export const API_BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
