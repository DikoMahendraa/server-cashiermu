-- AlterTable
ALTER TABLE "Transaction"
  ADD COLUMN "syncedAt" TIMESTAMP(3),
  ADD COLUMN "offlineReceiptNumber" TEXT,
  ADD COLUMN "offlineIssues" JSONB;
