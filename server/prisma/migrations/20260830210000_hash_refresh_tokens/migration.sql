-- Existing plaintext refresh tokens cannot be converted without retaining a
-- usable bearer credential. Invalidate them so users authenticate again.
DELETE FROM "RefreshToken";

COMMENT ON COLUMN "RefreshToken"."token" IS
'SHA-256 digest of the high-entropy refresh token; plaintext is never stored';
