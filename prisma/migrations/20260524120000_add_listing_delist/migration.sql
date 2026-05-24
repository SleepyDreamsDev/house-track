-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "delistedAt" TIMESTAMP(3),
ADD COLUMN     "delistReason" TEXT;

-- CreateIndex
CREATE INDEX "Listing_delistedAt_idx" ON "Listing"("delistedAt");

-- Backfill: estimate the delist time of existing inactive rows from lastSeenAt.
-- One-time production data migration; no-op on a fresh template DB.
UPDATE "Listing"
SET "delistedAt" = "lastSeenAt", "delistReason" = 'backfill_estimate'
WHERE "active" = false AND "delistedAt" IS NULL;
