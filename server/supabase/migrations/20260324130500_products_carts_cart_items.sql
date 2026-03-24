-- Issue #57: product listings + shopping carts
-- Depends on baseline migration that defines profiles and helper functions.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  farmer_wallet text not null references public.profiles(wallet_address) on delete cascade,
  name text not null,
  description text,
  category text,
  price_per_unit numeric(18, 6) not null check (price_per_unit > 0),
  currency text not null check (currency in ('STRK', 'USDC')),
  unit text not null,
  stock_quantity numeric(10, 2),
  image_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_stock_quantity_non_negative check (
    stock_quantity is null or stock_quantity >= 0
  )
);

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  buyer_wallet text not null references public.profiles(wallet_address) on delete cascade,
  status text not null default 'active' check (status in ('active', 'checked_out', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  farmer_wallet text not null,
  quantity numeric(10, 2) not null,
  unit_price numeric(18, 6) not null check (unit_price > 0),
  currency text not null check (currency in ('STRK', 'USDC')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint positive_quantity check (quantity > 0)
);

-- One active cart per buyer.
create unique index if not exists idx_carts_one_active_per_buyer
on public.carts (buyer_wallet)
where status = 'active';

-- Required indexes from issue scope.
create index if not exists idx_products_farmer_wallet_is_available
on public.products (farmer_wallet, is_available);

create index if not exists idx_cart_items_cart_id_farmer_wallet
on public.cart_items (cart_id, farmer_wallet);

create index if not exists idx_cart_items_cart_id on public.cart_items (cart_id);
create index if not exists idx_cart_items_product_id on public.cart_items (product_id);

create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger trg_carts_updated_at
before update on public.carts
for each row execute function public.set_updated_at();

create trigger trg_cart_items_updated_at
before update on public.cart_items
for each row execute function public.set_updated_at();

-- Ensure farmer_wallet and cart item snapshots are normalized and accurate.
create or replace function public.set_cart_item_snapshot()
returns trigger
language plpgsql
as $$
declare
  product_farmer_wallet text;
  product_currency text;
  product_unit_price numeric(18, 6);
begin
  select p.farmer_wallet, p.currency, p.price_per_unit
    into product_farmer_wallet, product_currency, product_unit_price
  from public.products p
  where p.id = new.product_id;

  if product_farmer_wallet is null then
    raise exception 'Product % not found', new.product_id;
  end if;

  new.farmer_wallet := lower(product_farmer_wallet);
  new.currency := product_currency;

  -- Snapshot price only on insert unless caller explicitly sets unit_price.
  if tg_op = 'INSERT' and (new.unit_price is null or new.unit_price <= 0) then
    new.unit_price := product_unit_price;
  end if;

  return new;
end;
$$;

create trigger trg_products_normalize_wallet
before insert or update on public.products
for each row execute function public.normalize_wallet();

create or replace function public.normalize_cart_and_item_wallets()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'carts' then
    if new.buyer_wallet is not null then
      new.buyer_wallet := lower(new.buyer_wallet);
    end if;
  elsif tg_table_name = 'cart_items' then
    if new.farmer_wallet is not null then
      new.farmer_wallet := lower(new.farmer_wallet);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_carts_normalize_wallet
before insert or update on public.carts
for each row execute function public.normalize_cart_and_item_wallets();

create trigger trg_cart_items_snapshot
before insert or update of product_id, farmer_wallet, currency, unit_price on public.cart_items
for each row execute function public.set_cart_item_snapshot();

create trigger trg_cart_items_normalize_wallet
before insert or update on public.cart_items
for each row execute function public.normalize_cart_and_item_wallets();

-- Keep carts.updated_at fresh when any cart item mutates.
create or replace function public.touch_parent_cart_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update public.carts set updated_at = now() where id = old.cart_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.cart_id is distinct from new.cart_id then
    update public.carts set updated_at = now() where id = old.cart_id;
  end if;

  update public.carts set updated_at = now() where id = new.cart_id;
  return new;
end;
$$;

create trigger trg_touch_cart_on_item_change
after insert or update or delete on public.cart_items
for each row execute function public.touch_parent_cart_updated_at();

alter table public.products enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;

-- Public product catalog (available only), and farmer-owned writes.
create policy "Public read available products"
on public.products
for select
to anon, authenticated
using (is_available = true);

create policy "Farmers can read own products"
on public.products
for select
to authenticated
using (farmer_wallet = public.current_wallet_address());

create policy "Farmers can insert own products"
on public.products
for insert
to authenticated
with check (
  farmer_wallet = public.current_wallet_address()
  and exists (
    select 1
    from public.profiles p
    where p.wallet_address = farmer_wallet
      and p.role = 'farmer'
  )
);

create policy "Farmers can update own products"
on public.products
for update
to authenticated
using (farmer_wallet = public.current_wallet_address())
with check (farmer_wallet = public.current_wallet_address());

create policy "Farmers can delete own products"
on public.products
for delete
to authenticated
using (farmer_wallet = public.current_wallet_address());

-- Buyer carts are private to owner.
create policy "Buyers read own carts"
on public.carts
for select
to authenticated
using (buyer_wallet = public.current_wallet_address());

create policy "Buyers insert own carts"
on public.carts
for insert
to authenticated
with check (
  buyer_wallet = public.current_wallet_address()
  and exists (
    select 1
    from public.profiles p
    where p.wallet_address = buyer_wallet
      and p.role = 'buyer'
  )
);

create policy "Buyers update own carts"
on public.carts
for update
to authenticated
using (buyer_wallet = public.current_wallet_address())
with check (buyer_wallet = public.current_wallet_address());

create policy "Buyers delete own carts"
on public.carts
for delete
to authenticated
using (buyer_wallet = public.current_wallet_address());

-- Cart items are owned through cart ownership; farmers cannot read buyer carts.
create policy "Buyers read own cart items"
on public.cart_items
for select
to authenticated
using (
  exists (
    select 1
    from public.carts c
    where c.id = cart_items.cart_id
      and c.buyer_wallet = public.current_wallet_address()
  )
);

create policy "Buyers insert own cart items"
on public.cart_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.carts c
    where c.id = cart_items.cart_id
      and c.buyer_wallet = public.current_wallet_address()
      and c.status = 'active'
  )
);

create policy "Buyers update own cart items"
on public.cart_items
for update
to authenticated
using (
  exists (
    select 1
    from public.carts c
    where c.id = cart_items.cart_id
      and c.buyer_wallet = public.current_wallet_address()
  )
)
with check (
  exists (
    select 1
    from public.carts c
    where c.id = cart_items.cart_id
      and c.buyer_wallet = public.current_wallet_address()
      and c.status = 'active'
  )
);

create policy "Buyers delete own cart items"
on public.cart_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.carts c
    where c.id = cart_items.cart_id
      and c.buyer_wallet = public.current_wallet_address()
      and c.status = 'active'
  )
);
