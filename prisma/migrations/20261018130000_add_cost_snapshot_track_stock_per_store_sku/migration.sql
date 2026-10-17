-- DropIndex
DROP INDEX "Product_sku_key";

-- DropIndex
DROP INDEX "Product_barcode_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "trackStock" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TransactionItem" ADD COLUMN     "costPrice" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_sku_key" ON "Product"("storeId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_barcode_key" ON "Product"("storeId", "barcode");


-- Backfill: existing sale lines get the product's CURRENT buy price as their cost.
-- This is an approximation for history (the true buy price at sale time was never stored);
-- every sale from now on stores the real cost at checkout.
UPDATE "TransactionItem" AS ti
SET "costPrice" = p."buyPrice"
FROM "Product" AS p
WHERE p."id" = ti."productId";
