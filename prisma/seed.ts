import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STORE_ID = 'store-default';

const CAT_IDS = {
  MAKANAN: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  MINUMAN: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
  SNACK: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
  ROKOK: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14',
  LAINNYA: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15',
};

async function main() {
  console.log('🌱 Seeding default categories...');

  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: { id: STORE_ID, name: 'CashierMu Dev Store' },
  });

  await Promise.all([
    prisma.category.upsert({
      where: { id: CAT_IDS.MAKANAN },
      update: {},
      create: {
        id: CAT_IDS.MAKANAN,
        name: 'Makanan',
        icon: 'utensils',
        color: '#f97316',
        sortOrder: 1,
        storeId: STORE_ID,
      },
    }),
    prisma.category.upsert({
      where: { id: CAT_IDS.MINUMAN },
      update: {},
      create: {
        id: CAT_IDS.MINUMAN,
        name: 'Minuman',
        icon: 'coffee',
        color: '#3b82f6',
        sortOrder: 2,
        storeId: STORE_ID,
      },
    }),
    prisma.category.upsert({
      where: { id: CAT_IDS.SNACK },
      update: {},
      create: { id: CAT_IDS.SNACK, name: 'Snack', icon: 'cookie', color: '#eab308', sortOrder: 3, storeId: STORE_ID },
    }),
    prisma.category.upsert({
      where: { id: CAT_IDS.ROKOK },
      update: {},
      create: {
        id: CAT_IDS.ROKOK,
        name: 'Rokok',
        icon: 'cigarette',
        color: '#6b7280',
        sortOrder: 4,
        storeId: STORE_ID,
      },
    }),
    prisma.category.upsert({
      where: { id: CAT_IDS.LAINNYA },
      update: {},
      create: {
        id: CAT_IDS.LAINNYA,
        name: 'Lainnya',
        icon: 'package',
        color: '#8b5cf6',
        sortOrder: 5,
        storeId: STORE_ID,
      },
    }),
  ]);

  console.log('✅ Seed complete!');
  console.log('   Daftar kategori default sudah tersedia.');
  console.log('   Gunakan POST /api/v1/auth/register untuk membuat toko dan akun owner.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
