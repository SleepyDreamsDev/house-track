-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "sector" TEXT;

-- CreateIndex
CREATE INDEX "Listing_sector_idx" ON "Listing"("sector");
