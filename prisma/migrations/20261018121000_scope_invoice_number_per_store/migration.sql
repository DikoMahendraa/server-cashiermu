-- DropIndex
DROP INDEX "Transaction_invoiceNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_storeId_invoiceNumber_key" ON "Transaction"("storeId", "invoiceNumber");

