-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lon" DOUBLE PRECISION,
ADD COLUMN     "authorId" TEXT,
ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "authorType" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "canonicalId" TEXT;

-- CreateIndex
CREATE INDEX "Listing_canonicalId_idx" ON "Listing"("canonicalId");

-- CreateIndex
CREATE INDEX "Listing_authorId_idx" ON "Listing"("authorId");
