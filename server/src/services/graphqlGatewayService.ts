import { ApiError } from "../http/errors.js";
import { listProducts, getProductGraphData } from "./productService.js";
import { OrderService } from "./orderService.js";
import { getProfileGraphData } from "./profileService.js";

type Variables = Record<string, unknown>;

interface RootField {
  alias: string | null;
  name: string;
  args: Record<string, unknown>;
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && isWhitespace(text[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}

function readIdentifier(text: string, index: number): { value: string; nextIndex: number } {
  let cursor = index;
  if (!isIdentifierStart(text[cursor]!)) {
    throw new ApiError(400, "Bad Request", "Invalid GraphQL query");
  }
  cursor += 1;
  while (cursor < text.length && isIdentifierPart(text[cursor]!)) {
    cursor += 1;
  }
  return { value: text.slice(index, cursor), nextIndex: cursor };
}

function readBalanced(text: string, index: number, openChar: string, closeChar: string): {
  value: string;
  nextIndex: number;
} {
  let cursor = index;
  let depth = 0;
  let inString = false;
  let escaped = false;

  while (cursor < text.length) {
    const char = text[cursor]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
    } else if (char === "\"") {
      inString = true;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { value: text.slice(index, cursor + 1), nextIndex: cursor + 1 };
      }
    }
    cursor += 1;
  }

  throw new ApiError(400, "Bad Request", "Unbalanced GraphQL selection");
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depthParens = 0;
  let depthBrackets = 0;
  let depthBraces = 0;
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      current += char;
      continue;
    }

    if (char === "(") depthParens += 1;
    if (char === ")") depthParens -= 1;
    if (char === "[") depthBrackets += 1;
    if (char === "]") depthBrackets -= 1;
    if (char === "{") depthBraces += 1;
    if (char === "}") depthBraces -= 1;

    if (char === "," && depthParens === 0 && depthBrackets === 0 && depthBraces === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseValue(value: string, variables: Variables): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith("$")) {
    return variables[trimmed.slice(1)] as unknown;
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitTopLevel(trimmed.slice(1, -1)).map((part) => parseValue(part, variables));
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return parseArgs(trimmed.slice(1, -1), variables);
  }
  return trimmed;
}

function parseArgs(argText: string, variables: Variables): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pairs = splitTopLevel(argText);
  for (const pair of pairs) {
    if (!pair) continue;
    const separatorIndex = pair.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1);
    result[key] = parseValue(value, variables);
  }
  return result;
}

function parseRootFields(query: string, variables: Variables): RootField[] {
  const firstBrace = query.indexOf("{");
  const lastBrace = query.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new ApiError(400, "Bad Request", "GraphQL query must contain a selection set");
  }

  const body = query.slice(firstBrace + 1, lastBrace);
  const fields: RootField[] = [];
  let index = 0;

  while (index < body.length) {
    index = skipWhitespace(body, index);
    if (index >= body.length) break;
    if (body[index] === ",") {
      index += 1;
      continue;
    }

    const first = readIdentifier(body, index);
    index = skipWhitespace(body, first.nextIndex);

    let alias: string | null = null;
    let name = first.value;

    if (body[index] === ":") {
      alias = first.value;
      index = skipWhitespace(body, index + 1);
      const actual = readIdentifier(body, index);
      name = actual.value;
      index = skipWhitespace(body, actual.nextIndex);
    }

    let args: Record<string, unknown> = {};
    if (body[index] === "(") {
      const balanced = readBalanced(body, index, "(", ")");
      args = parseArgs(balanced.value.slice(1, -1), variables);
      index = skipWhitespace(body, balanced.nextIndex);
    }

    if (body[index] === "{") {
      const balanced = readBalanced(body, index, "{", "}");
      index = balanced.nextIndex;
    }

    fields.push({ alias, name, args });
  }

  return fields;
}

function pickWallet(args: Record<string, unknown>, fallback?: string): string | undefined {
  const candidate = args.wallet ?? args.walletAddress ?? args.wallet_address ?? args.id;
  if (typeof candidate === "string" && candidate) return candidate;
  return fallback;
}

export async function executeGraphQL(
  query: string,
  variables: Variables,
  walletAddress?: string,
): Promise<{ data: Record<string, unknown>; errors: Array<{ message: string }> | undefined }> {
  const rootFields = parseRootFields(query, variables);
  const data: Record<string, unknown> = {};
  const errors: Array<{ message: string }> = [];

  for (const field of rootFields) {
    const key = field.alias ?? field.name;

    try {
      switch (field.name) {
        case "product": {
          const rawProductId = field.args.id ?? field.args.productId ?? "";
          const productId = typeof rawProductId === "string" ? rawProductId : "";
          if (!productId) throw new ApiError(400, "Bad Request", "product id is required");
          data[key] = await getProductGraphData(productId);
          break;
        }
        case "products": {
          const result = await listProducts({
            farmer: typeof field.args.farmer === "string" ? field.args.farmer : undefined,
            category: typeof field.args.category === "string" ? field.args.category : undefined,
            search: typeof field.args.search === "string" ? field.args.search : undefined,
            location: typeof field.args.location === "string" ? field.args.location : undefined,
            minPrice: typeof field.args.minPrice === "string" ? field.args.minPrice : undefined,
            maxPrice: typeof field.args.maxPrice === "string" ? field.args.maxPrice : undefined,
            page: typeof field.args.page === "string" ? field.args.page : undefined,
            pageSize: typeof field.args.pageSize === "string" ? field.args.pageSize : undefined,
            includeUnavailable:
              typeof field.args.includeUnavailable === "boolean"
                ? field.args.includeUnavailable
                : undefined,
          });
          data[key] = result;
          break;
        }
        case "order": {
          const rawOrderId = field.args.id ?? field.args.orderIdOnChain ?? field.args.orderId ?? "";
          const orderId = typeof rawOrderId === "string" ? rawOrderId : "";
          if (!orderId) throw new ApiError(400, "Bad Request", "order id is required");
          const order = await OrderService.getGraphOrder(orderId);
          if (walletAddress && order.buyerAddress !== walletAddress && order.sellerAddress !== walletAddress) {
            throw new ApiError(403, "Forbidden", "You do not have access to this order");
          }
          data[key] = order;
          break;
        }
        case "orders": {
          const address = pickWallet(field.args, walletAddress);
          if (!address) throw new ApiError(401, "Unauthorized", "Wallet address is required");
          data[key] = await OrderService.getAllForWallet(address);
          break;
        }
        case "profile": {
          const address = pickWallet(field.args, walletAddress);
          if (!address) throw new ApiError(401, "Unauthorized", "Wallet address is required");
          data[key] = await getProfileGraphData(address);
          break;
        }
        default:
          throw new ApiError(400, "Bad Request", `Unsupported GraphQL field: ${field.name}`);
      }
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : "GraphQL execution failed",
      });
    }
  }

  return {
    data,
    errors: errors.length > 0 ? errors : undefined,
  };
}
