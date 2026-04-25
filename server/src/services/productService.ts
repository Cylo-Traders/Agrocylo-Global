import { query } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { wsManager } from './wsManager.js';
import type { QueryResultRow } from 'pg';

export interface ProductWriteInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  price_per_unit?: string;
  currency?: 'STRK' | 'USDC';
  unit?: string;
  stock_quantity?: string | null;
  location?: string;
  is_available?: boolean;
}

interface ProductIdRow extends QueryResultRow {
  id: string;
}

interface ProductOwnerRow extends QueryResultRow {
  farmer_wallet: string;
}

function parsePage(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

export async function listProducts(params: {
  farmer?: string;
  category?: string;
  search?: string;
  location?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: string;
  pageSize?: string;
  includeUnavailable?: boolean;
}) {
  const page = parsePage(params.page, 1);
  const pageSize = Math.min(parsePage(params.pageSize, 20), 100);
  const where: string[] = ['is_available = true'];
  const values: unknown[] = [];

  if (params.includeUnavailable) {
    // Farmer dashboard needs access to both listed and unlisted products.
    where.length = 0;
  }

  if (params.farmer) {
    values.push(params.farmer.toLowerCase());
    where.push(`farmer_wallet = $${values.length}`);
  }
  if (params.category) {
    values.push(params.category);
    where.push(`category = $${values.length}`);
  }
  if (params.search) {
    const searchTerm = `%${params.search}%`;
    values.push(searchTerm, searchTerm, searchTerm);
    where.push(`(name ILIKE $${values.length - 2} OR COALESCE(description, '') ILIKE $${values.length - 1} OR COALESCE(category, '') ILIKE $${values.length})`);
  }
  if (params.location) {
    values.push(`%${params.location}%`);
    where.push(`location ILIKE $${values.length}`);
  }
  if (params.minPrice) {
    const minPrice = parseFloat(params.minPrice);
    if (!isNaN(minPrice)) {
      values.push(minPrice);
      where.push(`price_per_unit::numeric >= $${values.length}`);
    }
  }
  if (params.maxPrice) {
    const maxPrice = parseFloat(params.maxPrice);
    if (!isNaN(maxPrice)) {
      values.push(maxPrice);
      where.push(`price_per_unit::numeric <= $${values.length}`);
    }
  }

  values.push(pageSize, (page - 1) * pageSize);
  const whereClause = where.length > 0 ? `where ${where.join(' and ')}` : '';

  const countSql = `select count(*) as total from public.products ${whereClause}`;
  const countResult = await query(countSql, values.slice(0, -2)); // exclude pageSize and offset
  const total = parseInt(countResult.rows[0].total, 10);

  const sql = `
    select id::text, farmer_wallet, name, description, category,
           price_per_unit::text, currency, unit, stock_quantity::text,
           location, image_url, is_available, created_at, updated_at
    from public.products
    ${whereClause}
    order by created_at desc
    limit $${values.length - 1} offset $${values.length}
  `;
  const rows = await query(sql, values);
  return { page, page_size: pageSize, total, totalPages: Math.ceil(total / pageSize), items: rows.rows };
}

async function emitProductEvent(event: string, product: unknown) {
  wsManager.broadcast(event, product);
}

export async function getProductById(productId: string) {
  const result = await query(
    `select id::text, farmer_wallet, name, description, category,
            price_per_unit::text, currency, unit, stock_quantity::text,
            location, image_url, is_available, created_at, updated_at
     from public.products
     where id = $1::uuid`,
    [productId],
  );
  if (!result.rows[0]) throw new ApiError(404, 'Not Found', 'Product not found');
  return result.rows[0];
}

export async function createProduct(farmerWallet: string, input: ProductWriteInput) {
  if (!input.name || !input.price_per_unit || !input.currency || !input.unit) {
    throw new ApiError(400, 'Bad Request', 'name, price_per_unit, currency, and unit are required');
  }

  const inserted = await query<ProductIdRow>(
    `insert into public.products (
      farmer_wallet, name, description, category, price_per_unit, currency, unit, stock_quantity, location, is_available
    ) values ($1,$2,$3,$4,$5::numeric,$6,$7,$8::numeric,$9,$10)
    returning id::text`,
    [
      farmerWallet.toLowerCase(),
      input.name,
      input.description ?? null,
      input.category ?? null,
      input.price_per_unit,
      input.currency,
      input.unit,
      input.stock_quantity ?? null,
      input.location ?? null,
      input.is_available ?? true,
    ],
  );
  const result = await getProductById(String(inserted.rows[0]?.id));
  emitProductEvent('product:created', result);
  return result;
}

export async function updateProduct(productId: string, farmerWallet: string, input: ProductWriteInput) {
  const owner = await query<ProductOwnerRow>(
    `select farmer_wallet from public.products where id = $1::uuid`,
    [productId],
  );
  if (!owner.rows[0]) throw new ApiError(404, 'Not Found', 'Product not found');
  if (String(owner.rows[0].farmer_wallet).toLowerCase() !== farmerWallet.toLowerCase()) {
    throw new ApiError(403, 'Forbidden', 'You do not own this product');
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (k: string, v: unknown, cast = '') => {
    values.push(v);
    fields.push(`${k} = $${values.length}${cast}`);
  };

  if (input.name !== undefined) push('name', input.name);
  if (input.description !== undefined) push('description', input.description);
  if (input.category !== undefined) push('category', input.category);
  if (input.price_per_unit !== undefined) push('price_per_unit', input.price_per_unit, '::numeric');
  if (input.currency !== undefined) push('currency', input.currency);
  if (input.unit !== undefined) push('unit', input.unit);
  if (input.stock_quantity !== undefined) push('stock_quantity', input.stock_quantity, '::numeric');
  if (input.is_available !== undefined) push('is_available', input.is_available);

  if (fields.length === 0) throw new ApiError(400, 'Bad Request', 'No fields provided to update');
  values.push(productId);
  await query(`update public.products set ${fields.join(', ')} where id = $${values.length}::uuid`, values);
  const result = await getProductById(productId);
  emitProductEvent('product:updated', result);
  return result;
}

export async function softDeleteProduct(productId: string, farmerWallet: string) {
  const result = await updateProduct(productId, farmerWallet, { is_available: false });
  emitProductEvent('product:deleted', result);
  return result;
}
