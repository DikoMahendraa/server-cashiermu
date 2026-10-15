-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "discountEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discountType" TEXT NOT NULL DEFAULT 'percent',
ADD COLUMN     "discountValue" DECIMAL(15,2) NOT NULL DEFAULT 0;
