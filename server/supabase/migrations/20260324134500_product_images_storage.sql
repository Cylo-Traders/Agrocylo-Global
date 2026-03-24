-- Issue #58: Supabase Storage support for product images.
-- Depends on products table from issue #57.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Fallback placeholder for products without uploaded images.
alter table public.products
  alter column image_url set default 'https://placehold.co/800x800/png?text=No+Image';

update public.products
set image_url = coalesce(image_url, 'https://placehold.co/800x800/png?text=No+Image');

-- Storage object RLS.
alter table storage.objects enable row level security;

-- Public can read objects in this bucket.
create policy "Public read product images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

-- Farmers can write only under their own wallet prefix:
-- {farmer_wallet}/{product_id}/<file>
create policy "Farmers upload own product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and split_part(name, '/', 1) = public.current_wallet_address()
);

create policy "Farmers update own product images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and split_part(name, '/', 1) = public.current_wallet_address()
)
with check (
  bucket_id = 'product-images'
  and split_part(name, '/', 1) = public.current_wallet_address()
);

create policy "Farmers delete own product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and split_part(name, '/', 1) = public.current_wallet_address()
);
