# File Upload & Storage Architecture

This document describes the storage architecture, configuration, and error-handling semantics for file uploads in Agrocylo (specifically product images and dispute evidence).

---

## Storage Modes

The backend supports multiple storage paradigms depending on the operating environment:

| Mode | Environment | Description |
|---|---|---|
| **Supabase Storage** (Default) | Production / Staging | Managed object storage with public CDN URLs and Row-Level Security (RLS). Buckets: `product-images`, `dispute-evidence`. |
| **S3 / Cloudflare R2** | Optional Remote | Supabase Storage exposes an S3-compatible API that seamlessly integrates with Cloudflare R2 or AWS S3 buckets. |
| **Local Filesystem** | Development | Zero-dependency local storage. Uploads are stored in `server/uploads/product-images/` and served statically via the Express `/uploads` endpoint. |

---

## Configuration Reference

Set these variables in `server/.env` (see [`server/.env.example`](../../server/.env.example) and [`docs/deployment/environment.md`](./environment.md)):

```env
# Supabase Object Storage
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY"
SUPABASE_PRODUCT_IMAGES_BUCKET="product-images"

# Placeholder image fallback when product has no uploaded image
PRODUCT_IMAGE_PLACEHOLDER_URL="https://placehold.co/800x800/png?text=No+Image"
```

### Local Development Setup

To run locally without provisioning remote Supabase storage:
1. Leave `SUPABASE_SERVICE_ROLE_KEY` empty in development (`NODE_ENV=development`).
2. When an authenticated farmer uploads an image via `POST /products/:product_id/image`, the backend automatically falls back to local storage:
   - Original file: `uploads/product-images/<wallet>/<productId>/original-<uuid>.<ext>`
   - 400x400 thumbnail: `uploads/product-images/<wallet>/<productId>/thumbnail_400x400-<uuid>.webp`
   - 800x800 thumbnail: `uploads/product-images/<wallet>/<productId>/thumbnail_800x800-<uuid>.webp`
3. Images are immediately accessible to frontend clients at `/uploads/product-images/...`.

---

## Upload Validation & Constraints

All multipart file uploads are validated in two stages:

1. **Multer Middleware (`server/src/middleware/upload.ts`)**:
   - **Maximum File Size**: 5 MB (`5 * 1024 * 1024` bytes).
   - **Allowed MIME Types**: `image/jpeg`, `image/png`, `image/webp`.
   - **File Count Limit**: Exactly 1 file allowed per request under field name `image`.
   - **Field Limits**: Maximum 10 form fields, maximum field name length 100 bytes.

2. **Binary Inspection (`isValidImageBuffer`)**:
   - Inspects binary magic numbers (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`) before processing to prevent disguised executables or corrupt files.
   - Sharp decodes and re-encodes thumbnails, discarding malicious metadata and active payloads.

---

## Error Handling & HTTP Status Taxonomy

All image upload endpoints adhere to RFC 7807 Problem Details and return structured JSON responses with correlation `requestId`:

| Status Code | Code | Reason | Resolution |
|---|---|---|---|
| `400 Bad Request` | `MISSING_IMAGE_FIELD` | No file attached in `image` field | Attach a file using `multipart/form-data` |
| `400 Bad Request` | `LIMIT_FILE_COUNT` | More than 1 file uploaded | Send only a single file per product |
| `400 Bad Request` | `IMAGE_PROCESSING_FAILED` | Corrupted image data | Ensure file is a valid image |
| `401 Unauthorized` | `UNAUTHORIZED` | Missing or expired JWT session | Authenticate with wallet first |
| `403 Forbidden` | `FORBIDDEN` | Caller does not own the product | Only the farmer owning the product can upload |
| `404 Not Found` | `PRODUCT_NOT_FOUND` | Product ID does not exist | Verify the product ID |
| `413 Payload Too Large` | `LIMIT_FILE_SIZE` | File exceeds 5 MB | Compress or resize image below 5 MB |
| `415 Unsupported Media Type` | `UNSUPPORTED_MIME_TYPE` | Non-supported format | Use JPEG, PNG, or WebP |
| `503 Service Unavailable` | `STORAGE_UNAVAILABLE` | Remote storage unreachable | Check Supabase/S3 availability |
