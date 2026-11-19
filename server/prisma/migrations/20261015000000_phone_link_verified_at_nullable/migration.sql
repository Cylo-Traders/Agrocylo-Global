-- Phone links created via USSD (linkPhoneToWallet with isVerified=false) must be
-- able to represent an unverified state. The application and its unit tests
-- model this as a null `verified_at`; the baseline schema incorrectly declared
-- the column NOT NULL with a default, which made every link appear verified.
ALTER TABLE "phone_links" ALTER COLUMN "verified_at" DROP NOT NULL;
ALTER TABLE "phone_links" ALTER COLUMN "verified_at" DROP DEFAULT;
