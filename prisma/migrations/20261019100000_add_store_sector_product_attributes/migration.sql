-- CreateEnum
CREATE TYPE "BusinessSector" AS ENUM ('general', 'culinary', 'fashion', 'beauty', 'service', 'craft');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "sector" "BusinessSector" NOT NULL DEFAULT 'general';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '{}';

