import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { wsManager } from './wsManager.js';

const FEE_BPS = 3n;
const HUNDRED = 100n;

// CartItem.quantity is @db.Decimal(10, 2): 8 integer digits + 2 decimal places.
const QUANTITY_MAX_INT_DIGITS = 8;
const QUANTITY_MAX_SCALE = 2;

/**
 * Validates a cart item quantity before it reaches persistence. Rejects
 * non-numeric / non-finite input, zero, negatives, range overflow and values
 * with more fractional places than the column scale supports (issue #958).
 */
function validateQuantity(input: unknown): string {
  const value = String(input ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new ApiError(400, 'Bad Request', 'quantity must be a positive decimal number');
  }
  const [intPart, fracPart = ''] = value.split('.');
  const significant = intPart.replace(/^0+/, '');
  if (!significant || significant === '0') {
    throw new ApiError(400, 'Bad Request', 'quantity must be greater than zero');
  }
  if (significant.length > QUANTITY_MAX_INT_DIGITS) {
    throw new ApiError(400, 'Bad Request', `quantity is out of range (max ${QUANTITY_MAX_INT_DIGITS} integer digits)`);
  }
  if (fracPart.length > QUANTITY_MAX_SCALE) {
    throw new ApiError(400, 'Bad Request', `quantity supports at most ${QUANTITY_MAX_SCALE} decimal places`);
  }
  return value;
}

type CartItemRow = {
  item_id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: string;
  unit_price: string;
  currency: string;
  farmer_wallet: string;
  farmer_name: string;
  is_available: boolean;
};

type Tx = Prisma.TransactionClient;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function fee(amount: bigint): bigint {
  return (amount * FEE_BPS) / HUNDRED;
}

async function getOrCreateActiveCart(tx: Tx, wallet: string): Promise<string> {
  const existing = await tx.cart.findFirst({
    where: { buyerWallet: wallet, status: 'active' },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await tx.cart.create({
      data: { buyerWallet: wallet, status: 'active' },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Two concurrent requests each raced past the findFirst; the unique
    // partial index ("one active cart per buyer") lets only one win. Re-read
    // the winner instead of failing the request (issue #959).
    if (isUniqueViolation(error)) {
      const winner = await tx.cart.findFirst({
        where: { buyerWallet: wallet, status: 'active' },
        select: { id: true },
      });
      if (winner) return winner.id;
    }
    throw error;
  }
}

async function ensureCartActive(tx: Tx, cartId: string, buyerWallet: string): Promise<void> {
  const cart = await tx.cart.findFirst({
    where: { id: cartId, buyerWallet },
    select: { status: true },
  });
  if (!cart) throw new ApiError(404, 'Not Found', 'Active cart not found');
  if (cart.status !== 'active') throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
}

/**
 * Convert a decimal string to minor units (7 decimal places) as a BigInt,
 * avoiding floating-point precision loss.
 * e.g. "1.25" â†’ 12_500_000n
 */
function toMinorUnits(value: string): bigint {
  const DECIMALS = 7;
  const [intPart = '0', fracPart = ''] = value.split('.');
  const frac = fracPart.padEnd(DECIMALS, '0').slice(0, DECIMALS);
  return BigInt(intPart) * BigInt(10 ** DECIMALS) + BigInt(frac);
}

function groupRows(rows: CartItemRow[]) {
  const groups = new Map<string, { farmer_wallet: string; farmer_name: string; currency: string; subtotal: bigint; items: unknown[] }>();
  for (const row of rows) {
    const key = `${row.farmer_wallet}|${row.currency}`;
    const qtyMinor = toMinorUnits(row.quantity);
    const priceMinor = toMinorUnits(row.unit_price);
    // lineAmount in minor units: (qty * price) / 10^7
    const lineAmount = (qtyMinor * priceMinor) / BigInt(10 ** 7);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        farmer_wallet: row.farmer_wallet,
        farmer_name: row.farmer_name,
        currency: row.currency,
        subtotal: lineAmount,
        items: [{
          id: row.item_id,
          product_id: row.product_id,
          name: row.product_name,
          quantity: row.quantity,
          unit: row.unit,
          unit_price: row.unit_price,
        }],
      });
      continue;
    }
    existing.subtotal += lineAmount;
    existing.items.push({
      id: row.item_id,
      product_id: row.product_id,
      name: row.product_name,
      quantity: row.quantity,
      unit: row.unit,
      unit_price: row.unit_price,
    });
  }
  return Array.from(groups.values()).map((g) => ({ ...g, subtotal: g.subtotal.toString() }));
}

async function fetchCartRows(cartId: string, tx: Tx | typeof prisma = prisma): Promise<CartItemRow[]> {
  const items = await tx.cartItem.findMany({
    where: { cartId },
    orderBy: { createdAt: 'asc' },
    include: {
      product: {
        include: { farmer: true },
      },
    },
  });

  return items.map((item) => ({
    item_id: item.id,
    product_id: item.productId,
    product_name: item.product.name,
    unit: item.product.unit,
    quantity: item.quantity.toString(),
    unit_price: item.unitPrice.toString(),
    currency: item.currency,
    farmer_wallet: item.farmerWallet,
    farmer_name: item.product.farmer.name ?? '',
    is_available: item.product.isAvailable,
  }));
}

export async function getActiveCart(buyerWallet: string) {
  const cart = await prisma.cart.findFirst({
    where: { buyerWallet, status: 'active' },
    select: { id: true },
  });
  if (!cart) return { cart_id: null, groups: [] };
  const cartId = cart.id;
  const rows = await fetchCartRows(cartId);
  return { cart_id: cartId, groups: groupRows(rows) };
}

function emitCartEvent(buyerWallet: string, cartData: unknown) {
  wsManager.broadcastTo(buyerWallet, 'cart:updated', cartData);
}

export async function addItem(buyerWallet: string, payload: { product_id?: string; quantity?: string }) {
  if (!payload.product_id || !payload.quantity) {
    throw new ApiError(400, 'Bad Request', 'product_id and quantity are required');
  }
  const productId = payload.product_id;
  const quantity = validateQuantity(payload.quantity);

  return prisma.$transaction(async (tx) => {
    const cartId = await getOrCreateActiveCart(tx, buyerWallet);
    await ensureCartActive(tx, cartId, buyerWallet);
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        farmerWallet: true,
        pricePerUnit: true,
        currency: true,
        isAvailable: true,
      },
    });
    if (!product) throw new ApiError(404, 'Not Found', 'Product not found');
    if (!product.isAvailable) throw new ApiError(409, 'Conflict', 'Product is not available');

    await tx.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: {
        cartId,
        productId: product.id,
        farmerWallet: product.farmerWallet,
        quantity: new Prisma.Decimal(quantity),
        unitPrice: product.pricePerUnit,
        currency: product.currency,
      },
      update: {
        quantity: { increment: new Prisma.Decimal(quantity) },
      },
    });
    const rows = await fetchCartRows(cartId, tx);
    const result = { cart_id: cartId, groups: groupRows(rows) };
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function updateItemQuantity(buyerWallet: string, itemId: string, quantity: string) {
  const validated = validateQuantity(quantity);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.cartItem.updateMany({
      where: { id: itemId, cart: { buyerWallet, status: 'active' } },
      data: { quantity: new Prisma.Decimal(validated) },
    });
    if (updated.count === 0) {
      const owner = await tx.cartItem.findFirst({
        where: { id: itemId, cart: { buyerWallet } },
        select: { cart: { select: { status: true } } },
      });
      if (!owner) throw new ApiError(404, 'Not Found', 'Cart item not found');
      throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    }
    const ownerRow = await tx.cartItem.findFirst({
      where: { id: itemId, cart: { buyerWallet } },
      select: { cartId: true },
    });
    const cartId = ownerRow!.cartId;
    const rows = await fetchCartRows(cartId, tx);
    const result = { cart_id: cartId, groups: groupRows(rows) };
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function removeItem(buyerWallet: string, itemId: string) {
  return prisma.$transaction(async (tx) => {
    const owner = await tx.cartItem.findFirst({
      where: { id: itemId, cart: { buyerWallet } },
      select: { cartId: true, cart: { select: { status: true } } },
    });
    if (!owner) throw new ApiError(404, 'Not Found', 'Cart item not found');
    if (owner.cart.status !== 'active') throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    const removed = await tx.cartItem.deleteMany({
      where: { id: itemId, cart: { buyerWallet, status: 'active' } },
    });
    if (removed.count === 0) throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    const rows = await fetchCartRows(owner.cartId, tx);
    const result = { cart_id: owner.cartId, groups: groupRows(rows) };
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function clearCart(buyerWallet: string) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({
      where: { buyerWallet, status: 'active' },
      select: { id: true },
    });
    if (!cart) return { cart_id: null, groups: [] };
    const claimed = await tx.cart.updateMany({
      where: { id: cart.id, buyerWallet, status: 'active' },
      data: { updatedAt: new Date() },
    });
    if (claimed.count === 0) throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    const result = { cart_id: cart.id, groups: [] };
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function checkout(buyerWallet: string) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({
      where: { buyerWallet, status: 'active' },
      select: { id: true },
    });
    if (!cart) throw new ApiError(404, 'Not Found', 'Active cart not found');
    const cartId = cart.id;

    const rows = await fetchCartRows(cartId, tx);
    const unavailable = rows.filter((r) => !r.is_available);
    if (unavailable.length > 0) {
      throw new ApiError(409, 'Conflict', `Unavailable items in cart: ${unavailable.map((x) => x.product_name).join(', ')}`);
    }

    const grouped = groupRows(rows);
    const orders = grouped.map((group) => {
      const gross = BigInt(group.subtotal);
      const feeAmount = fee(gross);
      const net = gross - feeAmount;
      return {
        farmer_wallet: group.farmer_wallet,
        farmer_name: group.farmer_name,
        token: group.currency,
        gross_amount: gross.toString(),
        fee_amount: feeAmount.toString(),
        net_amount: net.toString(),
        items: group.items,
      };
    });
    const totalGross = orders.reduce((acc, o) => acc + BigInt(o.gross_amount), 0n);
    const totalFee = orders.reduce((acc, o) => acc + BigInt(o.fee_amount), 0n);
    const totalNet = orders.reduce((acc, o) => acc + BigInt(o.net_amount), 0n);

    const updated = await tx.cart.updateMany({
      where: { id: cartId, buyerWallet, status: 'active' },
      data: { status: 'checked_out' },
    });
    if (updated.count === 0) throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    return { orders, total_gross: totalGross.toString(), total_fee: totalFee.toString(), total_net: totalNet.toString() };
  });
}
