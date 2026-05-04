-- AlterTable
ALTER TABLE "SweepRun" ADD COLUMN     "source" TEXT NOT NULL DEFAULT '999.md',
ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT 'cron';
