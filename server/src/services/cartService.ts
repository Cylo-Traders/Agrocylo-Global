import type { PoolClient } from 'pg';
import { query, withTransaction } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { wsManager } from './wsManager.js';

const FEE_BPS = 3n;
const HUNDRED = 100n;

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

type CartIdRow = { id: string };
type CartStatusRow = { status: string };
type ExistingItemRow = { id: string; quantity: string };

function fee(amount: bigint): bigint {
  return (amount * FEE_BPS) / HUNDRED;
}

async function getOrCreateActiveCart(client: PoolClient, wallet: string): Promise<string> {
  const existing = await client.query<CartIdRow>(
    `select id::text from public.carts where buyer_wallet = $1 and status = 'active' limit 1`,
    [wallet],
  );
  if (existing.rows[0]) return String(existing.rows[0].id);
  const created = await client.query<CartIdRow>(
    `insert into public.carts (buyer_wallet, status) values ($1, 'active') returning id::text`,
    [wallet],
  );
  return String(created.rows[0]?.id);
}

async function ensureCartActive(client: PoolClient, cartId: string, buyerWallet: string): Promise<void> {
  const status = await client.query<CartStatusRow>(
    `select status from public.carts where id = $1::uuid and buyer_wallet = $2`,
    [cartId, buyerWallet],
  );
  if (!status.rows[0]) throw new ApiError(404, 'Not Found', 'Active cart not found');
  if (status.rows[0].status !== 'active') throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
}

function groupRows(rows: CartItemRow[]) {
  const groups = new Map<string, { farmer_wallet: string; farmer_name: string; currency: string; subtotal: string; items: unknown[] }>();
  for (const row of rows) {
    const key = `${row.farmer_wallet}|${row.currency}`;
    const lineAmount = BigInt(Math.trunc(Number(row.quantity) * Number(row.unit_price) * 1_000_000)) / 1_000_000n;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        farmer_wallet: row.farmer_wallet,
        farmer_name: row.farmer_name,
        currency: row.currency,
        subtotal: lineAmount.toString(),
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
    existing.subtotal = (BigInt(existing.subtotal) + lineAmount).toString();
    existing.items.push({
      id: row.item_id,
      product_id: row.product_id,
      name: row.product_name,
      quantity: row.quantity,
      unit: row.unit,
      unit_price: row.unit_price,
    });
  }
  return Array.from(groups.values());
}

async function fetchCartRows(cartId: string) {
  const items = await query<CartItemRow>(
    `select
      ci.id::text as item_id,
      ci.product_id::text as product_id,
      p.name as product_name,
      p.unit,
      ci.quantity::text,
      ci.unit_price::text,
      ci.currency,
      ci.farmer_wallet,
      pr.display_name as farmer_name,
      p.is_available
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    join public.profiles pr on pr.wallet_address = ci.farmer_wallet
    where ci.cart_id = $1::uuid
    order by ci.created_at asc`,
    [cartId],
  );
  return items.rows;
}

export async function getActiveCart(buyerWallet: string) {
  const cart = await query<CartIdRow>(
    `select id::text from public.carts where buyer_wallet = $1 and status = 'active' limit 1`,
    [buyerWallet],
  );
  if (!cart.rows[0]) return { cart_id: null, groups: [] };
  const cartId = String(cart.rows[0].id);
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

  return withTransaction(async (client) => {
    const cartId = await getOrCreateActiveCart(client, buyerWallet);
    await ensureCartActive(client, cartId, buyerWallet);
    const product = await client.query(
      `select id::text, farmer_wallet, price_per_unit::text, currency, is_available
       from public.products where id = $1::uuid`,
      [payload.product_id],
    );
    if (!product.rows[0]) throw new ApiError(404, 'Not Found', 'Product not found');
    if (!product.rows[0].is_available) throw new ApiError(409, 'Conflict', 'Product is not available');

    const existing = await client.query<ExistingItemRow>(
      `select id::text, quantity::text from public.cart_items where cart_id = $1::uuid and product_id = $2::uuid limit 1`,
      [cartId, payload.product_id],
    );

    if (existing.rows[0]) {
      await client.query(
        `update public.cart_items set quantity = quantity + $1::numeric where id = $2::uuid`,
        [payload.quantity, existing.rows[0].id],
      );
    } else {
      await client.query(
        `insert into public.cart_items (cart_id, product_id, farmer_wallet, quantity, unit_price, currency)
         values ($1::uuid,$2::uuid,$3,$4::numeric,$5::numeric,$6)`,
        [
          cartId,
          payload.product_id,
          product.rows[0].farmer_wallet,
          payload.quantity,
          product.rows[0].price_per_unit,
          product.rows[0].currency,
        ],
      );
    }
    const result = await getActiveCart(buyerWallet);
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function updateItemQuantity(buyerWallet: string, itemId: string, quantity: string) {
  return withTransaction(async (client) => {
    const owner = await client.query(
      `select ci.cart_id::text, c.status
       from public.cart_items ci
       join public.carts c on c.id = ci.cart_id
       where ci.id = $1::uuid and c.buyer_wallet = $2`,
      [itemId, buyerWallet],
    );
    if (!owner.rows[0]) throw new ApiError(404, 'Not Found', 'Cart item not found');
    if (owner.rows[0].status !== 'active') throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    await client.query(`update public.cart_items set quantity = $1::numeric where id = $2::uuid`, [quantity, itemId]);
    const result = await getActiveCart(buyerWallet);
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function removeItem(buyerWallet: string, itemId: string) {
  return withTransaction(async (client) => {
    const owner = await client.query(
      `select c.status
       from public.cart_items ci
       join public.carts c on c.id = ci.cart_id
       where ci.id = $1::uuid and c.buyer_wallet = $2`,
      [itemId, buyerWallet],
    );
    if (!owner.rows[0]) throw new ApiError(404, 'Not Found', 'Cart item not found');
    if (owner.rows[0].status !== 'active') throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    await client.query(`delete from public.cart_items where id = $1::uuid`, [itemId]);
    const result = await getActiveCart(buyerWallet);
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function clearCart(buyerWallet: string) {
  return withTransaction(async (client) => {
    const cart = await client.query<CartIdRow & CartStatusRow>(
      `select id::text, status from public.carts where buyer_wallet = $1 and status = 'active' limit 1`,
      [buyerWallet],
    );
    if (!cart.rows[0]) return { cart_id: null, groups: [] };
    if (cart.rows[0].status !== 'active') throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');
    await client.query(`delete from public.cart_items where cart_id = $1::uuid`, [cart.rows[0].id]);
    const result = { cart_id: String(cart.rows[0].id), groups: [] };
    emitCartEvent(buyerWallet, result);
    return result;
  });
}

export async function checkout(buyerWallet: string) {
  return withTransaction(async (client) => {
    const cart = await client.query<CartIdRow & CartStatusRow>(
      `select id::text, status from public.carts where buyer_wallet = $1 and status = 'active' limit 1`,
      [buyerWallet],
    );
    if (!cart.rows[0]) throw new ApiError(404, 'Not Found', 'Active cart not found');
    const cartId = String(cart.rows[0].id);
    if (cart.rows[0].status !== 'active') throw new ApiError(409, 'Conflict', 'Cart is checked out and read-only');

    const rows = await fetchCartRows(cartId);
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
        token_address: group.currency === 'STRK' ? '0x04718f5a...' : '0x053c9125...',
        gross_amount: gross.toString(),
        fee_amount: feeAmount.toString(),
        net_amount: net.toString(),
        items: group.items,
      };
    });
    const totalGross = orders.reduce((acc, o) => acc + BigInt(o.gross_amount), 0n);
    const totalFee = orders.reduce((acc, o) => acc + BigInt(o.fee_amount), 0n);
    const totalNet = orders.reduce((acc, o) => acc + BigInt(o.net_amount), 0n);

    await client.query(`update public.carts set status = 'checked_out' where id = $1::uuid`, [cartId]);
    return { orders, total_gross: totalGross.toString(), total_fee: totalFee.toString(), total_net: totalNet.toString() };
  });
}
