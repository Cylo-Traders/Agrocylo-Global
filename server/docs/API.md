# API Reference

Base URL: http://localhost:5000
Auth header: x-wallet-address: <stellar-public-key> (protected routes)

## Error format (RFC 7807)

{ "type": "...", "title": "Bad Request", "status": 400, "detail": "..." }

| Code | Meaning |
|------|---------|
| 400 | Missing or invalid field |
| 401 | Missing or invalid wallet header |
| 403 | Wallet does not own the resource |
| 404 | Not found |
| 409 | Conflict |
| 413 | Image exceeds 5MB |
| 415 | Unsupported image type |
| 500 | Internal server error |

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | — | Server status |

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/nonce | — | Generate sign challenge |
| POST | /auth/verify | — | Verify signature, get tokens |
| POST | /auth/refresh | — | Refresh access token |
| DELETE | /auth/logout | — | Revoke refresh token |

POST /auth/nonce
  Request:  { "walletAddress": "GABC...XYZ" }
  Response: { "nonce": "a3f9c2..." }

POST /auth/verify
  Request:  { "walletAddress": "GABC...XYZ", "signature": "<base64>" }
  Response: { "accessToken": "<jwt>", "refreshToken": "<hex>" }

POST /auth/refresh
  Request:  { "refreshToken": "<hex>" }
  Response: { "accessToken": "<jwt>" }

## Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /products | — | List products |
| GET | /products/:id | — | Get product |
| POST | /products | protected | Create product |
| PATCH | /products/:id | protected | Update product |
| DELETE | /products/:id | protected | Soft delete |
| POST | /products/:id/image | protected | Upload image max 5MB |
| DELETE | /products/:id/image | protected | Delete image |

GET /products query params:
  farmer             - filter by wallet address
  category           - filter by category
  page               - page number (default 1)
  page_size          - results per page (default 20, max 100)
  include_unavailable - include soft-deleted (true/false)

## Cart

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /cart | protected | Get active cart |
| POST | /cart/items | protected | Add item |
| PATCH | /cart/items/:id | protected | Update quantity |
| DELETE | /cart/items/:id | protected | Remove item |
| DELETE | /cart | protected | Clear cart |
| POST | /cart/checkout | protected | Checkout |

## Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /orders | — | List all orders |
| GET | /orders/:id | — | Get by on-chain ID |
| GET | /orders/buyer/:address | — | Orders by buyer |
| GET | /orders/seller/:address | — | Orders by seller |
| POST | /orders/metadata | protected | Create order metadata |
| GET | /orders/metadata/:id | protected | Get order metadata |

## Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /profiles/:wallet_address | — | Get profile |
| POST | /profiles | protected | Create profile |
| PATCH | /profiles/:wallet_address | protected | Update profile |

## Locations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /locations/farmers | — | List farmer locations |
| POST | /locations | protected | Set location |
| PATCH | /locations/:wallet_address | protected | Update location |
| DELETE | /locations/:wallet_address | protected | Delete location |
