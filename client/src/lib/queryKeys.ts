/**
 * Centralised query key factory. Broader keys are prefixes of narrower ones,
 * so invalidating `queryKeys.products.all()` cascades to lists and details.
 */
export const queryKeys = {
  products: {
    all: () => ["products"] as const,
    list: (filters?: Record<string, unknown>) =>
      ["products", "list", filters ?? {}] as const,
    mine: (wallet: string) => ["products", "mine", wallet] as const,
    detail: (id: string) => ["products", "detail", id] as const,
  },
  orders: {
    all: () => ["orders"] as const,
    asBuyer: (wallet: string) => ["orders", "buyer", wallet] as const,
    asSeller: (wallet: string) => ["orders", "seller", wallet] as const,
    detail: (id: string) => ["orders", "detail", id] as const,
  },
  cart: {
    all: (wallet?: string) => (wallet ? (["cart", wallet] as const) : (["cart"] as const)),
    byWallet: (wallet: string) => ["cart", wallet] as const,
  },
  profile: {
    byWallet: (wallet: string) => ["profile", wallet] as const,
  },
  notifications: {
    unread: (wallet: string) => ["notifications", "unread", wallet] as const,
  },
  farmerLocations: {
    all: () => ["farmer-locations"] as const,
  },
} as const;
