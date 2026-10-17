-- AlterTable
ALTER TABLE "TransactionItem" ADD COLUMN     "discountLabel" TEXT,
ADD COLUMN     "discountType" TEXT,
ADD COLUMN     "discountValue" DECIMAL(15,2);
