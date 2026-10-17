-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_storeId_idempotencyKey_key" ON "Transaction"("storeId", "idempotencyKey");

