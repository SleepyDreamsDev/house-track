-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "watchlist" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SweepRun" ALTER COLUMN "source" SET DEFAULT '999.md';

-- CreateIndex
CREATE INDEX "Listing_watchlist_lastFetchedAt_idx" ON "Listing"("watchlist", "lastFetchedAt");

-- CreateIndex
CREATE INDEX "Listing_active_lastFetchedAt_idx" ON "Listing"("active", "lastFetchedAt");
