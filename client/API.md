# API Documentation

Base URL: `http://localhost:5000` (configurable via `NEXT_PUBLIC_API_URL` env var)

## Products

### GET /products
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

### GET /products/:id
Get a single product by ID.

### POST /products
Create a new product listing.

**Body:** `{ name, category, price_per_unit, currency, unit, stock_quantity?, description?, is_available?, location?, delivery_window? }`

### PUT /products/:id
Update a product listing.

### DELETE /products/:id
Delete a product listing (farmer wallet required in auth).

## Orders

### GET /orders/buyer
Get orders where the current user is the buyer.

### GET /orders/seller
Get orders where the current user is the seller.

### POST /orders
Create a new order.

## Cart

### GET /cart/:walletAddress
Get active cart for a wallet.

### POST /cart/items
Add item to cart.

### PUT /cart/items/:id
Update cart item quantity.

### DELETE /cart/items/:id
Remove item from cart.

### DELETE /cart/:walletAddress
Clear entire cart.

## Profile

### GET /profile/:walletAddress
Get user profile.

### PUT /profile/:walletAddress
Update user profile.

## Notifications

### GET /notifications
Get paginated notifications.

### PUT /notifications/read
Mark notifications as read.

### DELETE /notifications/:id
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
