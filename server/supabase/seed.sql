-- Local/dev seed data for Agrocylo Supabase tables.
-- Uses deterministic wallet addresses for quick manual testing.

insert into public.profiles (wallet_address, role, display_name, bio, avatar_url)
values
  ('0x1111111111111111111111111111111111111111', 'farmer', 'Amina Fields', 'Cassava and maize farmer in Ibadan.', 'https://example.com/avatars/amina.png'),
  ('0x2222222222222222222222222222222222222222', 'farmer', 'Kofi Harvest', 'Rice grower focused on sustainable irrigation.', 'https://example.com/avatars/kofi.png'),
  ('0x3333333333333333333333333333333333333333', 'buyer', 'Lagos Foods Ltd', 'Bulk buyer for staple produce.', 'https://example.com/avatars/lagos-foods.png'),
  ('0x4444444444444444444444444444444444444444', 'buyer', 'Accra Grain Hub', 'Regional produce distributor.', 'https://example.com/avatars/accra-hub.png')
on conflict (wallet_address) do update
set
  role = excluded.role,
  display_name = excluded.display_name,
  bio = excluded.bio,
  avatar_url = excluded.avatar_url;

insert into public.locations (wallet_address, latitude, longitude, city, country, is_public)
values
  ('0x1111111111111111111111111111111111111111', 7.3775, 3.9470, 'Ibadan', 'Nigeria', true),
  ('0x2222222222222222222222222222222222222222', 5.6037, -0.1870, 'Accra', 'Ghana', true)
on conflict (wallet_address) do update
set
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  city = excluded.city,
  country = excluded.country,
  is_public = excluded.is_public;

insert into public.orders_metadata (on_chain_order_id, buyer_wallet, farmer_wallet, description)
values
  (1001, '0x3333333333333333333333333333333333333333', '0x1111111111111111111111111111111111111111', '5 metric tons of cassava roots'),
  (1002, '0x4444444444444444444444444444444444444444', '0x2222222222222222222222222222222222222222', '2 metric tons of polished rice')
on conflict (on_chain_order_id) do update
set
  buyer_wallet = excluded.buyer_wallet,
  farmer_wallet = excluded.farmer_wallet,
  description = excluded.description;
