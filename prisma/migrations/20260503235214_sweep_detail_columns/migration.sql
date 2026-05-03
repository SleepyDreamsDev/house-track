-- Migration: sweep-detail-columns
-- Adds JSON columns to SweepRun for richer detail-view persistence.
-- Reversible: each column is nullable and additive.
--
-- Run with:
--   pnpm prisma migrate dev --name sweep-detail-columns
--
-- After this lands, update prisma/schema.prisma SweepRun model to add:
--
--   configSnapshot   Json?
--   pagesDetail      Json?
--   detailsDetail    Json?
--   eventLog         Json?
--
-- Then `pnpm prisma generate`.

ALTER TABLE "SweepRun" ADD COLUMN "configSnapshot" JSONB;
ALTER TABLE "SweepRun" ADD COLUMN "pagesDetail"    JSONB;
ALTER TABLE "SweepRun" ADD COLUMN "detailsDetail"  JSONB;
ALTER TABLE "SweepRun" ADD COLUMN "eventLog"       JSONB;

-- Optional index if you query historical sweeps by source frequently:
-- CREATE INDEX IF NOT EXISTS "SweepRun_source_startedAt_idx"
--   ON "SweepRun" ("source", "startedAt" DESC);
