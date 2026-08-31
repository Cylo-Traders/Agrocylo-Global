-- Normalize historical order and campaign status casing to canonical UPPER_CASE.
-- Reconciliation and integrator queries rely on UPPER_CASE; historical rows written
-- with title-case (Pending, Delivered, Disputed, Active, Settled) or mixed case are
-- silently missed. This migration uppercases all existing values in place.

-- Orders: handle every historically observed variant (title-case, upper, mixed)
UPDATE "orders" SET "status" = UPPER("status") WHERE "status" != UPPER("status");

-- Campaigns: same
UPDATE "campaigns" SET "status" = UPPER("status") WHERE "status" != UPPER("status");

-- Disputes: canonical is UPPER (OPEN, RESOLVED, etc.) — normalize historical title-case
UPDATE "disputes" SET "status" = UPPER("status") WHERE "status" != UPPER("status");

-- Equipment rentals and group orders also store status strings; normalize for consistency
UPDATE "equipment_rentals" SET "status" = UPPER("status") WHERE "status" != UPPER("status");
UPDATE "group_orders" SET "status" = UPPER("status") WHERE "status" != UPPER("status");
