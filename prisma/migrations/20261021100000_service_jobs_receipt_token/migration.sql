-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'in_progress', 'ready', 'completed');

-- AlterTable
ALTER TABLE "Transaction"
  ADD COLUMN "customerPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "jobStatus" "JobStatus",
  ADD COLUMN "jobUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "receiptToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_receiptToken_key" ON "Transaction"("receiptToken");
CREATE INDEX "Transaction_storeId_jobStatus_idx" ON "Transaction"("storeId", "jobStatus");
