-- Rename the land-plot column. Values are stored in ares (999.md feature 245),
-- not square meters — see schema comment. RENAME preserves existing rows.
ALTER TABLE "Listing" RENAME COLUMN "landSqm" TO "landAre";
