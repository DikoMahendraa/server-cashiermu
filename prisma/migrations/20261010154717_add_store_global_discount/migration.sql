-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "cashierCanDiscount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "globalDiscountEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "globalDiscountType" TEXT NOT NULL DEFAULT 'percent',
ADD COLUMN     "globalDiscountValue" DECIMAL(15,2) NOT NULL DEFAULT 0;
