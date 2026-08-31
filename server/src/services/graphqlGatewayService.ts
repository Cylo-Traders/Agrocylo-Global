import { ApiError } from "../http/errors.js";
import { listProducts, getProductGraphData } from "./productService.js";
import { OrderService } from "./orderService.js";
import { getProfileGraphData } from "./profileService.js";
import {
  buildSchema,
  parse,
  validate,
  execute,
  Kind,
  specifiedRules,
  type DocumentNode,
  type GraphQLSchema,
} from "graphql";
// @ts-ignore - graphql-depth-limit has no types
import depthLimit from "graphql-depth-limit";
import { ScalarLeafsRule } from "graphql/validation/rules/ScalarLeafsRule.js";

type Variables = Record<string, unknown>;

// ── Limits (DoS mitigation) ───────────────────────────────────────────────
export const MAX_QUERY_SIZE = 8000;
export const MAX_DEPTH = 8;
export const MAX_ALIAS_COUNT = 30;
export const MAX_FIELD_COUNT = 100;

// ── Published schema ──────────────────────────────────────────────────────
const SCHEMA_SDL = `
  scalar JSON

  type Query {
    product(id: String, productId: String): JSON
    products(
      farmer: String
      category: String
      search: String
      location: String
      minPrice: String
      maxPrice: String
      page: String
      pageSize: String
      includeUnavailable: Boolean
    ): JSON
    order(id: String, orderId: String, orderIdOnChain: String): JSON
    orders(wallet: String, walletAddress: String, wallet_address: String, id: String): JSON
    profile(wallet: String, walletAddress: String, wallet_address: String, id: String): JSON
  }
`;

export const graphQLSchema: GraphQLSchema = buildSchema(SCHEMA_SDL);

export function getSchemaSDL(): string {
  return SCHEMA_SDL;
}

// ── Depth helpers (fragment-aware) ────────────────────────────────────────
function getFragments(document: DocumentNode): Map<string, any> {
  const map = new Map<string, any>();
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      map.set(def.name.value, def);
    }
  }
  return map;
}

function depthForSelectionSet(
  selectionSet: any,
  fragments: Map<string, any>,
  currentDepth: number,
  visitedFragments: Set<string>,
): number {
  if (!selectionSet) return currentDepth;
  let max = currentDepth;
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      const childDepth = sel.selectionSet
        ? depthForSelectionSet(sel.selectionSet, fragments, currentDepth + 1, visitedFragments)
        : currentDepth + 1;
      if (childDepth > max) max = childDepth;
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      const childDepth = depthForSelectionSet(sel.selectionSet, fragments, currentDepth + 1, visitedFragments);
      if (childDepth > max) max = childDepth;
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const name = sel.name.value as string;
      if (visitedFragments.has(name)) continue;
      visitedFragments.add(name);
      const frag = fragments.get(name);
      if (frag) {
        const childDepth = depthForSelectionSet(frag.selectionSet, fragments, currentDepth + 1, visitedFragments);
        if (childDepth > max) max = childDepth;
      }
      if (currentDepth + 1 > max) max = currentDepth + 1;
    }
  }
  return max;
}

export function calculateDepth(document: DocumentNode): number {
  const fragments = getFragments(document);
  let max = 0;
  for (const def of document.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) {
      const d = depthForSelectionSet(def.selectionSet, fragments, 0, new Set<string>());
      if (d > max) max = d;
    }
  }
  return max;
}

function countAliasesAndFields(document: DocumentNode): { aliasCount: number; fieldCount: number } {
  let aliasCount = 0;
  let fieldCount = 0;
  const fragments = getFragments(document);
  const visited = new Set<string>();

  function walkSelectionSet(selectionSet: any) {
    if (!selectionSet) return;
    for (const sel of selectionSet.selections) {
      if (sel.kind === Kind.FIELD) {
        fieldCount += 1;
        if (sel.alias) aliasCount += 1;
        if (sel.selectionSet) walkSelectionSet(sel.selectionSet);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        if (sel.selectionSet) walkSelectionSet(sel.selectionSet);
      } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
        const name = sel.name.value as string;
        if (visited.has(name)) continue;
        visited.add(name);
        const frag = fragments.get(name);
        if (frag?.selectionSet) walkSelectionSet(frag.selectionSet);
      }
    }
  }

  for (const def of document.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) {
      walkSelectionSet(def.selectionSet);
    }
  }
  return { aliasCount, fieldCount };
}

function enforceLimits(query: string, document: DocumentNode): void {
  if (query.length > MAX_QUERY_SIZE) {
    throw new ApiError(400, "Bad Request", `Query too large: ${query.length} > ${MAX_QUERY_SIZE} characters`);
  }
  const depth = calculateDepth(document);
  if (depth > MAX_DEPTH) {
    throw new ApiError(400, "Bad Request", `Query depth ${depth} exceeds limit of ${MAX_DEPTH}`);
  }
  const { aliasCount, fieldCount } = countAliasesAndFields(document);
  if (aliasCount > MAX_ALIAS_COUNT) {
    throw new ApiError(400, "Bad Request", `Alias count ${aliasCount} exceeds limit of ${MAX_ALIAS_COUNT}`);
  }
  if (fieldCount > MAX_FIELD_COUNT) {
    throw new ApiError(400, "Bad Request", `Field count ${fieldCount} exceeds limit of ${MAX_FIELD_COUNT}`);
  }
}

function isAdminRole(role?: string | null): boolean {
  return typeof role === "string" && role.toUpperCase() === "ADMIN";
}

/**
 * Execute a GraphQL query against the gateway schema.
 *
 * Security properties:
 *  - Uses graphql-js parse + validate against a published typed schema (no bespoke scanner).
 *  - Enforces max query size, depth (via manual + graphql-depth-limit), alias & field count (DoS).
 *  - For per-user fields `orders` / `profile`, the authenticated walletAddress is authoritative.
 *    Caller-supplied wallet args are rejected with 403 for non-admins unless they match the authenticated wallet.
 *    Admin callers may target another wallet explicitly.
 *  - Singular `order` checks buyer/seller ownership unless caller is admin.
 */
export async function executeGraphQL(
  query: string,
  variables: Variables,
  walletAddress?: string,
  callerRole?: string,
): Promise<{ data: Record<string, unknown>; errors: Array<{ message: string }> | undefined }> {
  if (!query || !query.trim()) {
    throw new ApiError(400, "Bad Request", "query is required");
  }

  let document: DocumentNode;
  try {
    document = parse(query);
  } catch (e) {
    throw new ApiError(400, "Bad Request", e instanceof Error ? e.message : "Invalid GraphQL query");
  }

  enforceLimits(query, document);

  // Allow sub-selections on JSON scalar (e.g. { orders { id } }) — the original bespoke parser
  // ignored inner selection sets, so existing clients send them. Filter ScalarLeafsRule.
  // Also apply graphql-depth-limit as an additional validation rule.
  const depthRule = depthLimit(MAX_DEPTH) as unknown as (typeof specifiedRules)[number];
  const validationRules = [...specifiedRules.filter((r) => r !== ScalarLeafsRule), depthRule];
  const validationErrors = validate(graphQLSchema, document, validationRules);
  if (validationErrors.length > 0) {
    const msg = validationErrors.map((err) => err.message).join("; ");
    throw new ApiError(400, "Bad Request", msg);
  }

  const admin = isAdminRole(callerRole);

  const rootValue: Record<string, any> = {
    product: async (args: Record<string, unknown>) => {
      const rawProductId = (args.id ?? args.productId ?? "") as unknown;
      const productId = typeof rawProductId === "string" ? rawProductId : "";
      if (!productId) throw new ApiError(400, "Bad Request", "product id is required");
      return getProductGraphData(productId);
    },

    products: async (args: Record<string, unknown>) => {
      return listProducts({
        farmer: typeof args.farmer === "string" ? args.farmer : undefined,
        category: typeof args.category === "string" ? args.category : undefined,
        search: typeof args.search === "string" ? args.search : undefined,
        location: typeof args.location === "string" ? args.location : undefined,
        minPrice: typeof args.minPrice === "string" ? args.minPrice : undefined,
        maxPrice: typeof args.maxPrice === "string" ? args.maxPrice : undefined,
        page: typeof args.page === "string" ? args.page : undefined,
        pageSize: typeof args.pageSize === "string" ? args.pageSize : undefined,
        includeUnavailable: typeof args.includeUnavailable === "boolean" ? args.includeUnavailable : undefined,
      });
    },

    order: async (args: Record<string, unknown>) => {
      const rawOrderId = (args.id ?? args.orderIdOnChain ?? args.orderId ?? "") as unknown;
      const orderId = typeof rawOrderId === "string" ? rawOrderId : "";
      if (!orderId) throw new ApiError(400, "Bad Request", "order id is required");
      const order = await OrderService.getGraphOrder(orderId);
      if (admin) return order;
      if (!walletAddress) {
        throw new ApiError(401, "Unauthorized", "Wallet address is required");
      }
      if (order.buyerAddress !== walletAddress && order.sellerAddress !== walletAddress) {
        throw new ApiError(403, "Forbidden", "You do not have access to this order");
      }
      return order;
    },

    orders: async (args: Record<string, unknown>) => {
      const requestedRaw = (args.wallet ?? args.walletAddress ?? args.wallet_address ?? args.id) as unknown;
      const requested = typeof requestedRaw === "string" && requestedRaw ? requestedRaw : undefined;

      if (requested) {
        const normalizedRequested = requested.toLowerCase();
        const normalizedAuthed = walletAddress ? walletAddress.toLowerCase() : undefined;
        if (normalizedAuthed && normalizedRequested !== normalizedAuthed && !admin) {
          throw new ApiError(403, "Forbidden", "You do not have access to this wallet's orders");
        }
        if (!admin && !walletAddress) {
          throw new ApiError(401, "Unauthorized", "Wallet address is required");
        }
        const address = admin && requested ? String(requested) : walletAddress;
        if (!address) throw new ApiError(401, "Unauthorized", "Wallet address is required");
        return OrderService.getAllForWallet(String(address));
      }

      if (!walletAddress) throw new ApiError(401, "Unauthorized", "Wallet address is required");
      return OrderService.getAllForWallet(walletAddress);
    },

    profile: async (args: Record<string, unknown>) => {
      const requestedRaw = (args.wallet ?? args.walletAddress ?? args.wallet_address ?? args.id) as unknown;
      const requested = typeof requestedRaw === "string" && requestedRaw ? requestedRaw : undefined;

      if (requested) {
        const normalizedRequested = requested.toLowerCase();
        const normalizedAuthed = walletAddress ? walletAddress.toLowerCase() : undefined;
        if (normalizedAuthed && normalizedRequested !== normalizedAuthed && !admin) {
          throw new ApiError(403, "Forbidden", "You do not have access to this profile");
        }
        if (!admin && !walletAddress) {
          throw new ApiError(401, "Unauthorized", "Wallet address is required");
        }
        const address = admin && requested ? String(requested) : walletAddress;
        if (!address) throw new ApiError(401, "Unauthorized", "Wallet address is required");
        return getProfileGraphData(String(address));
      }

      if (!walletAddress) throw new ApiError(401, "Unauthorized", "Wallet address is required");
      return getProfileGraphData(walletAddress);
    },
  };

  const result: any = await execute({
    schema: graphQLSchema,
    document,
    rootValue,
    variableValues: variables as any,
    contextValue: { walletAddress, callerRole },
  });

  const errors = result.errors
    ? result.errors.map((e: any) => ({
        message: e.message ?? "GraphQL execution failed",
      }))
    : undefined;

  return {
    data: (result.data as Record<string, unknown>) ?? {},
    errors,
  };
}
