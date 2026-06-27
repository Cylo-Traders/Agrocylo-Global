# Database Query Audit

## Scope

Audited `server/src/services` and `server/src/controllers` for mixed database access patterns:

- `query(...)`
- `client.query(...)`
- `db.query(...)`
- `prisma.$queryRaw`
- `prisma.$executeRaw`

## Result

No raw SQL calls remain in production services or controllers. Database access now goes through the shared Prisma client from `src/config/database.ts`.

## Converted Areas

- `authService`: nonce and refresh token reads/writes now use Prisma model APIs.
- `productService`: product listing, filtering, pagination, creation, update, and soft-delete now use Prisma model APIs and typed `Prisma.Decimal` values.
- `productImageService`: product ownership and image URL updates now use Prisma model APIs.
- `cartService`: cart creation, item mutation, grouping reads, clearing, and checkout now use Prisma transactions and relation includes.

## Raw SQL Exceptions

None in production services or controllers.

One app-level exception remains in `src/app.ts`: the health endpoint executes a static `SELECT 1` through `prisma.$queryRaw` to verify database connectivity. It has no user input or dynamic parameters, and the inline comment documents that security boundary.

If a future query requires raw SQL for a PostgreSQL-specific feature such as a CTE, window function, or lock mode that cannot be represented cleanly in Prisma, it must:

- use `prisma.$queryRaw` or `prisma.$executeRaw` tagged template parameters, never string concatenation;
- include a nearby security comment explaining why Prisma ORM APIs are not sufficient;
- document the query in this audit file with its rationale and parameterization approach.

## Guardrail

`src/config/securityGuardrails.test.ts` scans production services and controllers for raw SQL entry points and fails if new raw database access is introduced without changing the policy.
