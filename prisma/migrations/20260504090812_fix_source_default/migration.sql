-- Fix source column default from '999.md' to '999md' to match Source.slug convention
ALTER TABLE "SweepRun" ALTER COLUMN "source" SET DEFAULT '999md';
