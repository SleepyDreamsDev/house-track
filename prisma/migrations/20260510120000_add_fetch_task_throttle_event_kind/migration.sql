-- AlterTable
ALTER TABLE "SweepRun" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'legacy';

-- CreateTable
CREATE TABLE "FetchTask" (
    "id" SERIAL NOT NULL,
    "listingId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThrottleEvent" (
    "id" SERIAL NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "context" JSONB,

    CONSTRAINT "ThrottleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FetchTask_priority_scheduledFor_idx" ON "FetchTask"("priority", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "FetchTask_listingId_reason_key" ON "FetchTask"("listingId", "reason");

-- CreateIndex
CREATE INDEX "ThrottleEvent_triggeredAt_idx" ON "ThrottleEvent"("triggeredAt");
