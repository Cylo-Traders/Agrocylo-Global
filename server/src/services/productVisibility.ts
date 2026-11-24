// Who may list unavailable (hidden or soft-deleted) products (#1427).
//
// `include_unavailable` used to be honoured for anyone, including anonymous
// callers, which exposed records the public marketplace is meant to hide. It is
// now honoured only for:
//   - an admin session, or
//   - a signed-in farmer asking for their own products (`farmer` filter equals
//     their wallet), so they cannot see other farmers' unavailable listings.
// For everyone else the flag is ignored and only available products are
// returned. Pure so the route and the GraphQL gateway share one rule.

export interface UnavailableVisibilityInput {
  /** Whether the caller asked for unavailable products. */
  requested: boolean | undefined;
  /** The `farmer` filter on the request, if any. */
  farmer?: string;
  /** Verified wallet from the session, if the caller is signed in. */
  walletAddress?: string;
  /** Role from the session, if any. */
  role?: string;
}

export function canIncludeUnavailable(input: UnavailableVisibilityInput): boolean {
  if (!input.requested) return false;
  if (!input.walletAddress) return false;
  if (typeof input.role === 'string' && input.role.toUpperCase() === 'ADMIN') return true;
  return (
    typeof input.farmer === 'string' &&
    input.farmer.length > 0 &&
    input.farmer.toLowerCase() === input.walletAddress.toLowerCase()
  );
}
