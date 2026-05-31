# API Documentation

Base URL: `http://localhost:5000` (configurable via `NEXT_PUBLIC_API_URL` env var)

## Products

### GET /api/products
List products with optional filters.

**Query Parameters:**
- `search` - Search by name/description
- `category` - Filter by category (Vegetables, Fruits, Grains, Tubers, Livestock, Other)
- `farmer_wallet` - Filter by farmer
- `min_price` / `max_price` - Price range
- `currency` - STRK or USDC
- `unit` - kg, bag, crate, piece, litre, dozen
- `is_available` - boolean
- `page` / `limit` - Pagination

**Response:** `{ data: Product[], total: number, page: number, limit: number }`

### GET /api/products/:id
Get a single product by ID.

### POST /api/products
Create a new product listing.

**Body:** `{ name, category, price_per_unit, currency, unit, stock_quantity?, description?, is_available?, location?, delivery_window? }`

### PUT /api/products/:id
Update a product listing.

### DELETE /api/products/:id
Delete a product listing (farmer wallet required in auth).

## Orders

### GET /api/orders/buyer
Get orders where the current user is the buyer.

### GET /api/orders/seller
Get orders where the current user is the seller.

### POST /api/orders
Create a new order.

## Cart

### GET /api/cart/:walletAddress
Get active cart for a wallet.

### POST /api/cart/items
Add item to cart.

### PUT /api/cart/items/:id
Update cart item quantity.

### DELETE /api/cart/items/:id
Remove item from cart.

### DELETE /api/cart/:walletAddress
Clear entire cart.

## Profile

### GET /api/profile/:walletAddress
Get user profile.

### PUT /api/profile/:walletAddress
Update user profile.

## Notifications

### GET /api/notifications
Get paginated notifications.

### PUT /api/notifications/read
Mark notifications as read.

### DELETE /api/notifications/:id
Delete a notification.

## Locations

### GET /locations/farmers
Get farmer locations for map display.

**Query Parameters:**
- `lat` / `lng` - Center coordinates
- `radius` - Search radius in km

## Error Codes

| Code | Description |
|---|---|
| `VALIDATION_ERROR` | Request body failed validation |
| `NOT_FOUND` | Resource not found |
| `UNAUTHORIZED` | Missing or invalid auth |
| `FORBIDDEN` | Insufficient permissions |
| `NETWORK_ERROR` | Backend unreachable |
| `CONTRACT_ERROR` | Soroban contract interaction failed |
| `RATE_LIMITED` | Too many requests |

## Rate Limiting

- 100 requests per minute per IP
- 10 requests per second for write endpoints
- Retry-After header included in 429 responses
