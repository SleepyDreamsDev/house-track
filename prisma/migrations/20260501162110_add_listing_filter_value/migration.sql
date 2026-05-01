-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL,
    "lastFetchedAt" DATETIME NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "filterValuesEnrichedAt" DATETIME,
    "title" TEXT NOT NULL,
    "priceEur" INTEGER,
    "priceRaw" TEXT,
    "rooms" INTEGER,
    "areaSqm" REAL,
    "landSqm" REAL,
    "district" TEXT,
    "street" TEXT,
    "floors" INTEGER,
    "yearBuilt" INTEGER,
    "heatingType" TEXT,
    "description" TEXT,
    "features" TEXT,
    "imageUrls" TEXT,
    "sellerType" TEXT,
    "postedAt" DATETIME,
    "bumpedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ListingFilterValue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "listingId" TEXT NOT NULL,
    "filterId" INTEGER NOT NULL DEFAULT 0,
    "featureId" INTEGER NOT NULL,
    "optionId" INTEGER,
    "textValue" TEXT,
    "numericValue" REAL,
    CONSTRAINT "ListingFilterValue_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "listingId" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceEur" INTEGER,
    "description" TEXT,
    "rawHtmlHash" TEXT NOT NULL,
    CONSTRAINT "ListingSnapshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SweepRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "detailsFetched" INTEGER NOT NULL DEFAULT 0,
    "newListings" INTEGER NOT NULL DEFAULT 0,
    "updatedListings" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT
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
