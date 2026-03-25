export type CartItem = {
  id: string; // cart_item uuid
  product_id: string;
  product_name: string;
  name?: string;
  quantity: string; // numeric string
  unit: string;
  unit_price: string; // numeric string
};

export type CartGroup = {
  farmer_wallet: string;
  farmer_name: string;
  currency: string; // STRK / USDC
  subtotal: string; // numeric string (already in base units per current backend logic)
  items: Array<{
    id: string;
    product_id: string;
    name: string;
    quantity: string;
    unit: string;
    unit_price: string;
  }>;
};

export type CartState = {
  cart_id: string | null;
  groups: CartGroup[];
};

