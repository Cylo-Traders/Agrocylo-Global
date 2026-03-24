-- Agrocylo Supabase baseline schema for profile/location/order metadata.
-- This migration is safe to run in Supabase Postgres.

create extension if not exists pgcrypto;
create extension if not exists postgis;

-- Shared helper to keep wallet matching case-insensitive.
create or replace function public.normalize_wallet()
returns trigger
language plpgsql
as $$
begin
  if new.wallet_address is not null then
    new.wallet_address := lower(new.wallet_address);
  end if;

  if tg_table_name = 'orders_metadata' then
    if new.buyer_wallet is not null then
      new.buyer_wallet := lower(new.buyer_wallet);
    end if;
    if new.farmer_wallet is not null then
      new.farmer_wallet := lower(new.farmer_wallet);
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Reads wallet identity from JWT custom claim set by your auth layer.
create or replace function public.current_wallet_address()
returns text
language sql
stable
as $$
  select lower(
    coalesce(
      nullif(auth.jwt() ->> 'wallet_address', ''),
      nullif(auth.jwt() ->> 'walletAddress', '')
    )
  );
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  role text not null check (role in ('farmer', 'buyer')),
  display_name text not null,
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_wallet_address_unique unique (wallet_address)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  geohash text generated always as (
    st_geohash(st_setsrid(st_makepoint(longitude, latitude), 4326), 8)
  ) stored,
  city text,
  country text,
  is_public boolean not null default true,
  updated_at timestamptz not null default now(),
  location_geog geography(point, 4326) generated always as (
    st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
  ) stored,
  constraint locations_wallet_address_unique unique (wallet_address),
  constraint locations_latitude_range check (latitude between -90 and 90),
  constraint locations_longitude_range check (longitude between -180 and 180)
);

create table if not exists public.orders_metadata (
  id uuid primary key default gen_random_uuid(),
  on_chain_order_id bigint not null unique,
  buyer_wallet text not null,
  farmer_wallet text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_normalize_wallet
before insert or update on public.profiles
for each row execute function public.normalize_wallet();

create trigger trg_locations_normalize_wallet
before insert or update on public.locations
for each row execute function public.normalize_wallet();

create trigger trg_orders_metadata_normalize_wallet
before insert or update on public.orders_metadata
for each row execute function public.normalize_wallet();

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger trg_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create trigger trg_orders_metadata_updated_at
before update on public.orders_metadata
for each row execute function public.set_updated_at();

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_wallet_lower on public.profiles ((lower(wallet_address)));
create index if not exists idx_locations_wallet on public.locations (wallet_address);
create index if not exists idx_locations_geohash on public.locations (geohash);
create index if not exists idx_locations_geog_gist on public.locations using gist (location_geog);
create index if not exists idx_orders_on_chain_order_id on public.orders_metadata (on_chain_order_id);
create index if not exists idx_orders_buyer_wallet on public.orders_metadata (buyer_wallet);
create index if not exists idx_orders_farmer_wallet on public.orders_metadata (farmer_wallet);

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.orders_metadata enable row level security;

-- Profiles: users can read all profiles, but can only mutate their own profile.
create policy "Profiles are readable by authenticated users"
on public.profiles
for select
to authenticated
using (true);

create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (wallet_address = public.current_wallet_address());

create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (wallet_address = public.current_wallet_address())
with check (wallet_address = public.current_wallet_address());

-- Locations: authenticated users can read only public farmer locations.
create policy "Authenticated users read public farmer locations"
on public.locations
for select
to authenticated
using (
  is_public = true
  and exists (
    select 1
    from public.profiles p
    where p.wallet_address = locations.wallet_address
      and p.role = 'farmer'
  )
);

create policy "Users can read own location regardless of visibility"
on public.locations
for select
to authenticated
using (wallet_address = public.current_wallet_address());

create policy "Users can insert own location"
on public.locations
for insert
to authenticated
with check (wallet_address = public.current_wallet_address());

create policy "Users can update own location"
on public.locations
for update
to authenticated
using (wallet_address = public.current_wallet_address())
with check (wallet_address = public.current_wallet_address());

-- Orders metadata: only counterparties can read or mutate metadata.
create policy "Buyer or farmer can read order metadata"
on public.orders_metadata
for select
to authenticated
using (
  buyer_wallet = public.current_wallet_address()
  or farmer_wallet = public.current_wallet_address()
);

create policy "Buyer or farmer can insert order metadata"
on public.orders_metadata
for insert
to authenticated
with check (
  buyer_wallet = public.current_wallet_address()
  or farmer_wallet = public.current_wallet_address()
);

create policy "Buyer or farmer can update order metadata"
on public.orders_metadata
for update
to authenticated
using (
  buyer_wallet = public.current_wallet_address()
  or farmer_wallet = public.current_wallet_address()
)
with check (
  buyer_wallet = public.current_wallet_address()
  or farmer_wallet = public.current_wallet_address()
);

-- Utility function for proximity search using PostGIS.
create or replace function public.farmers_within_radius(
  in_latitude double precision,
  in_longitude double precision,
  in_radius_meters integer
)
returns table (
  wallet_address text,
  display_name text,
  city text,
  country text,
  latitude double precision,
  longitude double precision,
  distance_meters double precision
)
language sql
stable
as $$
  select
    p.wallet_address,
    p.display_name,
    l.city,
    l.country,
    l.latitude,
    l.longitude,
    st_distance(
      l.location_geog,
      st_setsrid(st_makepoint(in_longitude, in_latitude), 4326)::geography
    ) as distance_meters
  from public.locations l
  join public.profiles p on p.wallet_address = l.wallet_address
  where p.role = 'farmer'
    and l.is_public = true
    and st_dwithin(
      l.location_geog,
      st_setsrid(st_makepoint(in_longitude, in_latitude), 4326)::geography,
      in_radius_meters
    )
  order by distance_meters asc;
$$;
