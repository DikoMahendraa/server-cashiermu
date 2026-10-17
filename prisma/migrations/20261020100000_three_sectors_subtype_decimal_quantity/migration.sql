-- Only three business types are supported: general (Retail/Umum), culinary (Kuliner), service (Jasa & Layanan).
-- Stores that picked a removed type (fashion, beauty, craft) fall back to 'general' — their products are untouched.
-- AlterEnum
BEGIN;
CREATE TYPE "BusinessSector_new" AS ENUM ('general', 'culinary', 'service');
ALTER TABLE "Store" ALTER COLUMN "sector" DROP DEFAULT;
ALTER TABLE "Store" ALTER COLUMN "sector" TYPE "BusinessSector_new" USING (
  CASE WHEN "sector"::text IN ('general', 'culinary', 'service') THEN "sector"::text ELSE 'general' END
)::"BusinessSector_new";
ALTER TYPE "BusinessSector" RENAME TO "BusinessSector_old";
ALTER TYPE "BusinessSector_new" RENAME TO "BusinessSector";
DROP TYPE "BusinessSector_old";
ALTER TABLE "Store" ALTER COLUMN "sector" SET DEFAULT 'general';
COMMIT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "subtype" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allowDecimalQty" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TransactionItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

