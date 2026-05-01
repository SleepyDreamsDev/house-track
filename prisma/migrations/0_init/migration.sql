-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "filterValuesEnrichedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "priceEur" INTEGER,
    "priceRaw" TEXT,
    "rooms" INTEGER,
    "areaSqm" DOUBLE PRECISION,
    "landSqm" DOUBLE PRECISION,
    "district" TEXT,
    "street" TEXT,
    "floors" INTEGER,
    "yearBuilt" INTEGER,
    "heatingType" TEXT,
    "description" TEXT,
    "features" JSONB,
    "imageUrls" JSONB,
    "sellerType" TEXT,
    "postedAt" TIMESTAMP(3),
    "bumpedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingFilterValue" (
    "id" SERIAL NOT NULL,
    "listingId" TEXT NOT NULL,
    "filterId" INTEGER NOT NULL DEFAULT 0,
    "featureId" INTEGER NOT NULL,
    "optionId" INTEGER,
    "textValue" TEXT,
    "numericValue" DOUBLE PRECISION,

    CONSTRAINT "ListingFilterValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingSnapshot" (
    "id" SERIAL NOT NULL,
    "listingId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceEur" INTEGER,
    "description" TEXT,
    "rawHtmlHash" TEXT NOT NULL,

    CONSTRAINT "ListingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SweepRun" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "detailsFetched" INTEGER NOT NULL DEFAULT 0,
    "newListings" INTEGER NOT NULL DEFAULT 0,
    "updatedListings" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "SweepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Listing_url_key" ON "Listing"("url");

-- CreateIndex
CREATE INDEX "Listing_active_lastSeenAt_idx" ON "Listing"("active", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Listing_priceEur_idx" ON "Listing"("priceEur");

-- CreateIndex
CREATE INDEX "ListingFilterValue_filterId_featureId_optionId_idx" ON "ListingFilterValue"("filterId", "featureId", "optionId");

-- CreateIndex
CREATE INDEX "ListingFilterValue_listingId_idx" ON "ListingFilterValue"("listingId");

-- CreateIndex
CREATE INDEX "ListingFilterValue_featureId_optionId_idx" ON "ListingFilterValue"("featureId", "optionId");

-- CreateIndex
CREATE INDEX "ListingSnapshot_listingId_capturedAt_idx" ON "ListingSnapshot"("listingId", "capturedAt");

-- AddForeignKey
ALTER TABLE "ListingFilterValue" ADD CONSTRAINT "ListingFilterValue_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingSnapshot" ADD CONSTRAINT "ListingSnapshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
