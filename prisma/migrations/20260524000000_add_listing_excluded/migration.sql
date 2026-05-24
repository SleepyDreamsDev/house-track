-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "excluded" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Listing_excluded_idx" ON "Listing"("excluded");
