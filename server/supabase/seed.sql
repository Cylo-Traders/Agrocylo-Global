-- Local/dev seed data for Agrocylo Supabase tables.
-- Uses deterministic wallet addresses for quick manual testing.

insert into public.profiles (wallet_address, role, display_name, bio, avatar_url)
values
  ('0x1111111111111111111111111111111111111111', 'farmer', 'Amina Fields', 'Cassava and maize farmer in Ibadan.', 'https://example.com/avatars/amina.png'),
  ('0x2222222222222222222222222222222222222222', 'farmer', 'Kofi Harvest', 'Rice grower focused on sustainable irrigation.', 'https://example.com/avatars/kofi.png'),
  ('0x5555555555555555555555555555555555555555', 'farmer', 'Zara Orchard', 'Fruit and vegetable cooperative in Kumasi.', 'https://example.com/avatars/zara.png'),
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
  ('0x2222222222222222222222222222222222222222', 5.6037, -0.1870, 'Accra', 'Ghana', true),
  ('0x5555555555555555555555555555555555555555', 6.6885, -1.6244, 'Kumasi', 'Ghana', true)
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

insert into public.products (
  farmer_wallet, name, description, category, price_per_unit, currency, unit, stock_quantity, image_url, is_available
)
values
  -- Farmer 1: Amina
  ('0x1111111111111111111111111111111111111111', 'Fresh Cassava', 'Freshly harvested cassava roots.', 'grains', 1.250000, 'USDC', 'kg', 1200.00, 'https://example.com/products/cassava.jpg', true),
  ('0x1111111111111111111111111111111111111111', 'Yellow Maize', 'Dried yellow maize for feed and flour.', 'grains', 0.980000, 'USDC', 'kg', 950.00, 'https://example.com/products/maize.jpg', true),
  ('0x1111111111111111111111111111111111111111', 'Sorghum Bag', 'Premium sorghum in 50kg bags.', 'grains', 18.500000, 'USDC', 'bag', 120.00, 'https://example.com/products/sorghum-bag.jpg', true),
  ('0x1111111111111111111111111111111111111111', 'Yam Crate', 'Warehouse-grade yams in crates.', 'vegetables', 22.000000, 'USDC', 'crate', 45.00, 'https://example.com/products/yam-crate.jpg', true),
  ('0x1111111111111111111111111111111111111111', 'Millet Batch', 'Export quality millet.', 'grains', 1.100000, 'STRK', 'kg', 600.00, 'https://example.com/products/millet.jpg', true),
  -- Farmer 2: Kofi
  ('0x2222222222222222222222222222222222222222', 'Polished Rice', 'Medium grain polished rice.', 'grains', 1.800000, 'USDC', 'kg', 800.00, 'https://example.com/products/rice.jpg', true),
  ('0x2222222222222222222222222222222222222222', 'Brown Rice', 'Whole brown rice, nutrient rich.', 'grains', 2.050000, 'USDC', 'kg', 500.00, 'https://example.com/products/brown-rice.jpg', true),
  ('0x2222222222222222222222222222222222222222', 'Rice Husk Bale', 'Compressed rice husk for biomass.', 'grains', 9.000000, 'STRK', 'bale', 85.00, 'https://example.com/products/rice-husk.jpg', true),
  ('0x2222222222222222222222222222222222222222', 'Paddy Rice Bag', 'Unmilled paddy rice in 25kg bags.', 'grains', 15.750000, 'USDC', 'bag', 140.00, 'https://example.com/products/paddy-bag.jpg', true),
  ('0x2222222222222222222222222222222222222222', 'Broken Rice', 'Budget broken rice for processing.', 'grains', 1.150000, 'USDC', 'kg', 420.00, 'https://example.com/products/broken-rice.jpg', true),
  -- Farmer 3: Zara
  ('0x5555555555555555555555555555555555555555', 'Mango Box', 'Sweet mangoes sorted by size.', 'fruits', 14.200000, 'USDC', 'box', 90.00, 'https://example.com/products/mango-box.jpg', true),
  ('0x5555555555555555555555555555555555555555', 'Pineapple Piece', 'Fresh pineapple ready for retail.', 'fruits', 1.650000, 'USDC', 'piece', 300.00, 'https://example.com/products/pineapple.jpg', true),
  ('0x5555555555555555555555555555555555555555', 'Plantain Bunch', 'Green plantain bunches.', 'fruits', 3.400000, 'USDC', 'piece', 160.00, 'https://example.com/products/plantain.jpg', true),
  ('0x5555555555555555555555555555555555555555', 'Tomato Crate', 'Greenhouse tomatoes in crates.', 'vegetables', 19.900000, 'STRK', 'crate', 55.00, 'https://example.com/products/tomato-crate.jpg', true),
  ('0x5555555555555555555555555555555555555555', 'Pepper Sack', 'Mixed hot peppers in sacks.', 'vegetables', 12.750000, 'USDC', 'bag', 70.00, 'https://example.com/products/pepper-sack.jpg', true);
