// Single source of truth for business types ("sectors"), the kinds inside them ("subtypes"), and everything that
// changes with them: wording, units, starter categories, extra product fields, variant presets and starter items.
//
// The server validates `Product.attributes` against the store's kind, the app draws its screens from this config
// (GET /sectors), and import/export templates will be generated from it. To change a form, edit this file only.
// Rules: never rename or remove a field `key` that already holds data; bump SECTOR_CONFIG_VERSION when you change
// anything; adding a kind needs no database migration (`Store.subtype` is validated against this file).

import type { BusinessSector } from '@prisma/client';
import type {
  FieldDef,
  FieldOption,
  ItemTemplate,
  SectorCategory,
  SectorConfig,
  SubtypeConfig,
  UnitOption,
  VariantPreset,
  Vocabulary,
} from './sector.types';

export const SECTOR_CONFIG_VERSION = 4;

// ─── Small builders ──────────────────────────────────────────────────────────

const opt = (value: string, label: string): FieldOption => ({ value, label });
const unit = (value: string, label: string, decimal = false): UnitOption => ({ value, label, decimal });
const cat = (name: string, icon: string, color: string): SectorCategory => ({ name, icon, color });
const preset = (name: string, options: string[], required = false, multiSelect = false): VariantPreset => ({
  name,
  required,
  multiSelect,
  options,
});
const tpl = (
  name: string,
  category: string,
  unitValue: string,
  trackStock: boolean,
  attributes?: Record<string, unknown>,
): ItemTemplate => ({ name, category, unit: unitValue, trackStock, ...(attributes ? { attributes } : {}) });

type SubtypeInput = Omit<SubtypeConfig, 'vocabulary' | 'trackStockDefault'> & {
  /** Only what differs from the sector's base wording. */
  vocabulary?: Partial<Vocabulary>;
  trackStockDefault?: boolean;
};

function defineSector(input: {
  id: BusinessSector;
  label: string;
  description: string;
  icon: string;
  defaultSubtype: string;
  vocabulary: Vocabulary;
  trackStockDefault: boolean;
  subtypes: SubtypeInput[];
}): SectorConfig {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    icon: input.icon,
    defaultSubtype: input.defaultSubtype,
    subtypes: input.subtypes.map(subtype => ({
      ...subtype,
      vocabulary: { ...input.vocabulary, ...subtype.vocabulary },
      trackStockDefault: subtype.trackStockDefault ?? input.trackStockDefault,
    })),
  };
}

// ─── Shared units ────────────────────────────────────────────────────────────

// Retail keeps the exact list the app always had.
const RETAIL_UNITS = [
  unit('pcs', 'Pcs'),
  unit('porsi', 'Porsi'),
  unit('gelas', 'Gelas'),
  unit('cup', 'Cup'),
  unit('botol', 'Botol'),
  unit('bungkus', 'Bungkus'),
  unit('kotak', 'Kotak'),
  unit('pak', 'Pak'),
  unit('kg', 'Kg'),
  unit('gram', 'Gram'),
  unit('liter', 'Liter'),
  unit('ml', 'Ml'),
];

const WARRANTY_DAYS: FieldDef = {
  key: 'warrantyDays',
  label: 'Garansi',
  type: 'number',
  min: 0,
  max: 3650,
  unit: 'hari',
  help: 'Kosongkan jika tidak ada garansi.',
};

// ─── Retail / Umum ───────────────────────────────────────────────────────────

const GENERAL = defineSector({
  id: 'general',
  label: 'Retail / Umum',
  description: 'Toko dan usaha dagang dengan produk biasa. Tanpa isian tambahan.',
  icon: 'store',
  defaultSubtype: 'default',
  trackStockDefault: true,
  vocabulary: {
    item: 'Produk',
    itemLower: 'produk',
    tabLabel: 'Produk',
    addItem: 'Tambah Produk',
    editItem: 'Edit Produk',
    addFirstItem: 'Tambah Produk Pertama',
    nameLabel: 'Nama Produk',
    namePlaceholder: 'Contoh: Sabun Mandi 100 gr',
    skuPlaceholder: 'Contoh: PRD-001',
    searchPlaceholder: 'Cari produk atau SKU...',
    emptyTitle: 'Belum ada produk',
    emptyHint: 'Tambahkan produk agar bisa dijual di kasir.',
    infoSection: 'Informasi Produk',
    photoSection: 'Foto Produk',
    priceLabel: 'Harga Jual',
    costLabel: 'Harga Beli (HPP)',
    costHint: 'Modal per satuan. Dipakai untuk menghitung laba.',
    unitLabel: 'Satuan',
    stockSection: 'Inventaris',
    variantSection: 'Varian & Opsi Tambahan',
    variantHint: 'Contoh: ukuran, warna.',
    variantGroupPlaceholder: 'Nama grup (mis. Ukuran)',
    variantOptionPlaceholder: 'Opsi (mis. Besar)',
    cartNoun: 'Keranjang',
    businessNoun: 'Toko',
    notePlaceholder: 'Contoh: bungkus kado, ganti warna jika kosong...',
  },
  subtypes: [
    {
      id: 'default',
      label: 'Retail / Umum',
      description: 'Toko dan usaha dagang dengan produk biasa.',
      icon: 'store',
      units: RETAIL_UNITS,
      defaultUnit: 'pcs',
      categories: [
        cat('Makanan', 'utensils', '#f97316'),
        cat('Minuman', 'coffee', '#3b82f6'),
        cat('Lainnya', 'package', '#8b5cf6'),
      ],
      fields: [],
      variantPresets: [preset('Ukuran', ['S', 'M', 'L', 'XL']), preset('Warna', ['Hitam', 'Putih', 'Merah', 'Biru'])],
      templates: [],
    },
  ],
});

// ─── Kuliner ─────────────────────────────────────────────────────────────────

const CULINARY_FIELDS: FieldDef[] = [
  {
    key: 'servingTypes',
    label: 'Tipe Penyajian',
    type: 'multiselect',
    options: [opt('dine_in', 'Dine-in'), opt('takeaway', 'Takeaway'), opt('delivery', 'Delivery')],
  },
  {
    key: 'prepTimeMinutes',
    label: 'Estimasi Waktu Penyajian',
    type: 'number',
    min: 0,
    max: 1440,
    unit: 'menit',
    placeholder: 'Contoh: 10',
  },
];

const FOOD_PRESETS = [
  preset('Level Pedas', ['Tidak Pedas', 'Sedang', 'Pedas', 'Extra Pedas']),
  preset('Porsi', ['Reguler', 'Jumbo']),
  preset('Tambahan', ['Telur', 'Keju', 'Sosis', 'Kerupuk'], false, true),
];

const DRINK_PRESETS = [
  preset('Ukuran', ['Reguler', 'Large'], true),
  preset('Sugar Level', ['Normal', 'Less Sugar', 'No Sugar']),
  preset('Ice Level', ['Normal', 'Less Ice', 'No Ice']),
  preset('Topping', ['Boba', 'Jelly', 'Cheese Foam'], false, true),
];

const FOOD_TEMPLATES = [
  tpl('Nasi Goreng Spesial', 'Makanan Utama', 'porsi', true, { prepTimeMinutes: 10 }),
  tpl('Mie Ayam', 'Makanan Utama', 'porsi', true, { prepTimeMinutes: 8 }),
  tpl('Ayam Geprek', 'Makanan Utama', 'porsi', true, { prepTimeMinutes: 12 }),
  tpl('Soto Ayam', 'Makanan Utama', 'porsi', true, { prepTimeMinutes: 8 }),
  tpl('Pisang Goreng', 'Camilan', 'porsi', true, { prepTimeMinutes: 7 }),
  tpl('Roti Bakar', 'Camilan', 'porsi', true, { prepTimeMinutes: 7 }),
  tpl('Nasi Box Ayam Bakar', 'Paket/Catering', 'kotak', true),
];

const DRINK_TEMPLATES = [
  tpl('Kopi Susu Gula Aren', 'Kopi', 'gelas', true, { prepTimeMinutes: 5 }),
  tpl('Americano', 'Kopi', 'gelas', true, { prepTimeMinutes: 4 }),
  tpl('Es Teh Manis', 'Teh', 'gelas', true, { prepTimeMinutes: 2 }),
  tpl('Lemon Tea', 'Teh', 'gelas', true, { prepTimeMinutes: 3 }),
  tpl('Matcha Latte', 'Non-Kopi', 'gelas', true, { prepTimeMinutes: 5 }),
  tpl('Jus Alpukat', 'Jus & Smoothie', 'gelas', true, { prepTimeMinutes: 6 }),
  tpl('Air Mineral', 'Lainnya', 'botol', true),
];

const CULINARY = defineSector({
  id: 'culinary',
  label: 'Kuliner',
  description: 'Warung, kafe, katering, dan usaha makanan atau minuman.',
  icon: 'utensils',
  defaultSubtype: 'food_beverage',
  trackStockDefault: true,
  vocabulary: {
    item: 'Menu',
    itemLower: 'menu',
    tabLabel: 'Menu',
    addItem: 'Tambah Menu',
    editItem: 'Edit Menu',
    addFirstItem: 'Tambah Menu Pertama',
    nameLabel: 'Nama Menu',
    namePlaceholder: 'Contoh: Nasi Goreng Spesial',
    skuPlaceholder: 'Contoh: MNU-001',
    searchPlaceholder: 'Cari menu atau SKU...',
    emptyTitle: 'Belum ada menu',
    emptyHint: 'Tambahkan menu agar bisa dijual di kasir.',
    infoSection: 'Informasi Menu',
    photoSection: 'Foto Menu',
    priceLabel: 'Harga Jual',
    costLabel: 'Harga Pokok (HPP)',
    costHint: 'Biaya bahan per porsi. Dipakai untuk menghitung laba.',
    unitLabel: 'Satuan',
    stockSection: 'Stok',
    variantSection: 'Varian & Tambahan Menu',
    variantHint: 'Contoh: level pedas, porsi, topping.',
    variantGroupPlaceholder: 'Nama grup (mis. Level Pedas)',
    variantOptionPlaceholder: 'Opsi (mis. Pedas)',
    cartNoun: 'Pesanan',
    businessNoun: 'Usaha',
    notePlaceholder: 'Contoh: tidak terlalu pedas, tanpa bawang...',
  },
  subtypes: [
    {
      id: 'food',
      label: 'Makanan',
      description: 'Warung makan, katering, bakery, dan camilan.',
      icon: 'utensils',
      vocabulary: { namePlaceholder: 'Contoh: Nasi Goreng Spesial', skuPlaceholder: 'Contoh: MKN-001' },
      units: [
        unit('porsi', 'Porsi'),
        unit('pcs', 'Pcs'),
        unit('bungkus', 'Bungkus'),
        unit('kotak', 'Kotak'),
        unit('paket', 'Paket'),
      ],
      defaultUnit: 'porsi',
      categories: [
        cat('Makanan Utama', 'utensils', '#f97316'),
        cat('Camilan', 'cookie', '#eab308'),
        cat('Paket/Catering', 'package', '#8b5cf6'),
        cat('Lainnya', 'package', '#64748b'),
      ],
      fields: CULINARY_FIELDS,
      variantPresets: FOOD_PRESETS,
      templates: FOOD_TEMPLATES,
    },
    {
      id: 'beverage',
      label: 'Minuman',
      description: 'Kedai kopi, es teh, jus, dan minuman lainnya.',
      icon: 'coffee',
      vocabulary: {
        namePlaceholder: 'Contoh: Es Kopi Susu Gula Aren',
        skuPlaceholder: 'Contoh: MNM-001',
        variantHint: 'Contoh: ukuran, sugar level, ice level, topping.',
        variantGroupPlaceholder: 'Nama grup (mis. Ukuran)',
        variantOptionPlaceholder: 'Opsi (mis. Large)',
        notePlaceholder: 'Contoh: less sugar, tanpa es...',
      },
      units: [
        unit('gelas', 'Gelas'),
        unit('cup', 'Cup'),
        unit('botol', 'Botol'),
        unit('pcs', 'Pcs'),
        unit('paket', 'Paket'),
      ],
      defaultUnit: 'gelas',
      categories: [
        cat('Kopi', 'coffee', '#92400e'),
        cat('Non-Kopi', 'cup-soda', '#3b82f6'),
        cat('Teh', 'leaf', '#10b981'),
        cat('Jus & Smoothie', 'citrus', '#f97316'),
        cat('Lainnya', 'package', '#64748b'),
      ],
      fields: CULINARY_FIELDS,
      variantPresets: DRINK_PRESETS,
      templates: DRINK_TEMPLATES,
    },
    {
      id: 'food_beverage',
      label: 'Makanan & Minuman',
      description: 'Kafe atau resto yang menjual makanan sekaligus minuman.',
      icon: 'utensils',
      vocabulary: { variantHint: 'Contoh: level pedas, ukuran, sugar level, topping.' },
      units: [
        unit('porsi', 'Porsi'),
        unit('gelas', 'Gelas'),
        unit('pcs', 'Pcs'),
        unit('cup', 'Cup'),
        unit('botol', 'Botol'),
        unit('bungkus', 'Bungkus'),
        unit('kotak', 'Kotak'),
        unit('paket', 'Paket'),
      ],
      defaultUnit: 'porsi',
      categories: [
        cat('Makanan Utama', 'utensils', '#f97316'),
        cat('Minuman', 'coffee', '#3b82f6'),
        cat('Camilan', 'cookie', '#eab308'),
        cat('Paket/Catering', 'package', '#8b5cf6'),
      ],
      fields: CULINARY_FIELDS,
      variantPresets: [
        FOOD_PRESETS[0],
        FOOD_PRESETS[2],
        DRINK_PRESETS[0],
        DRINK_PRESETS[1],
        DRINK_PRESETS[2],
        DRINK_PRESETS[3],
      ],
      templates: [
        tpl('Nasi Goreng Spesial', 'Makanan Utama', 'porsi', true, { prepTimeMinutes: 10 }),
        tpl('Mie Ayam', 'Makanan Utama', 'porsi', true, { prepTimeMinutes: 8 }),
        tpl('Roti Bakar', 'Camilan', 'porsi', true, { prepTimeMinutes: 7 }),
        tpl('Kentang Goreng', 'Camilan', 'porsi', true, { prepTimeMinutes: 6 }),
        tpl('Kopi Susu Gula Aren', 'Minuman', 'gelas', true, { prepTimeMinutes: 5 }),
        tpl('Es Teh Manis', 'Minuman', 'gelas', true, { prepTimeMinutes: 2 }),
        tpl('Jus Alpukat', 'Minuman', 'gelas', true, { prepTimeMinutes: 6 }),
        tpl('Air Mineral', 'Minuman', 'botol', true),
      ],
    },
  ],
});

// ─── Jasa & Layanan ──────────────────────────────────────────────────────────

/** Services that also sell goods (spare parts, ATK) ask "service or goods?"; goods track stock, services do not. */
const kindField = (goodsValue: 'part' | 'goods', serviceLabel: string, goodsLabel: string): FieldDef => ({
  key: 'kind',
  label: 'Jenis',
  type: 'select',
  required: true,
  options: [opt('service', serviceLabel), opt(goodsValue, goodsLabel)],
  trackStockByValue: { service: false, [goodsValue]: true },
});

const isService: FieldDef['showWhen'] = { field: 'kind', equals: 'service' };

const SERVICE = defineSector({
  id: 'service',
  label: 'Jasa & Layanan',
  description: 'Servis AC, laundry, bengkel, pijat, percetakan, dan jasa lainnya.',
  icon: 'wrench',
  defaultSubtype: 'general_service',
  trackStockDefault: false,
  vocabulary: {
    item: 'Layanan',
    itemLower: 'layanan',
    tabLabel: 'Layanan',
    addItem: 'Tambah Layanan',
    editItem: 'Edit Layanan',
    addFirstItem: 'Tambah Layanan Pertama',
    nameLabel: 'Nama Layanan',
    namePlaceholder: 'Contoh: Jasa Servis Panggilan',
    skuPlaceholder: 'Contoh: JSA-001',
    searchPlaceholder: 'Cari layanan atau SKU...',
    emptyTitle: 'Belum ada layanan',
    emptyHint: 'Tambahkan layanan agar bisa dijual di kasir.',
    infoSection: 'Informasi Layanan',
    photoSection: 'Foto Layanan',
    priceLabel: 'Tarif',
    costLabel: 'Modal / Biaya (HPP)',
    costHint: 'Biaya bahan atau tenaga per satuan. Dipakai untuk menghitung laba.',
    unitLabel: 'Satuan Tarif',
    stockSection: 'Stok (sparepart / bahan)',
    variantSection: 'Opsi & Tambahan Layanan',
    variantHint: 'Contoh: layanan tambahan atau pilihan tarif.',
    variantGroupPlaceholder: 'Nama grup (mis. Layanan Tambahan)',
    variantOptionPlaceholder: 'Opsi (mis. Antar-Jemput)',
    cartNoun: 'Daftar Layanan',
    businessNoun: 'Usaha',
    notePlaceholder: 'Contoh: catatan khusus untuk layanan ini...',
  },
  subtypes: [
    {
      id: 'ac',
      label: 'Servis AC',
      description: 'Cuci, servis, pasang, bongkar, dan isi freon AC.',
      icon: 'snowflake',
      vocabulary: {
        namePlaceholder: 'Contoh: Cuci AC Split 1 PK',
        skuPlaceholder: 'Contoh: AC-001',
        variantHint: 'Contoh: kapasitas AC, tambahan freon atau kapasitor.',
        variantGroupPlaceholder: 'Nama grup (mis. Kapasitas AC)',
        variantOptionPlaceholder: 'Opsi (mis. 1,5 – 2 PK)',
        notePlaceholder: 'Contoh: unit di lantai 2, AC bocor di indoor...',
      },
      units: [
        unit('unit', 'Per Unit AC'),
        unit('pcs', 'Pcs'),
        unit('paket', 'Paket'),
        unit('meter', 'Meter', true),
        unit('jam', 'Jam', true),
      ],
      defaultUnit: 'unit',
      categories: [
        cat('Cuci & Servis', 'snowflake', '#3b82f6'),
        cat('Perbaikan', 'wrench', '#f97316'),
        cat('Pemasangan & Bongkar', 'hammer', '#64748b'),
        cat('Freon & Sparepart', 'package', '#10b981'),
      ],
      fields: [
        kindField('part', 'Jasa', 'Sparepart / Freon'),
        {
          key: 'capacity',
          label: 'Kapasitas AC',
          type: 'select',
          options: [
            opt('pk_05_1', '0,5 – 1 PK'),
            opt('pk_15_2', '1,5 – 2 PK'),
            opt('pk_25_plus', '2,5 PK ke atas'),
            opt('all', 'Semua kapasitas'),
          ],
          showWhen: isService,
        },
        {
          key: 'durationMinutes',
          label: 'Estimasi Pengerjaan',
          type: 'number',
          min: 1,
          max: 1440,
          unit: 'menit',
          placeholder: 'Contoh: 45',
          showWhen: isService,
        },
        { ...WARRANTY_DAYS, showWhen: isService },
        {
          key: 'partBrand',
          label: 'Merek',
          type: 'text',
          maxLength: 60,
          placeholder: 'Contoh: Daikin',
          showWhen: { field: 'kind', equals: 'part' },
        },
      ],
      variantPresets: [
        preset('Kapasitas AC', ['0,5 – 1 PK', '1,5 – 2 PK', '2,5 PK ke atas']),
        preset('Tambahan', ['Tambah Freon', 'Ganti Kapasitor', 'Bongkar Pasang'], false, true),
      ],
      templates: [
        tpl('Cuci AC Split 0,5–1 PK', 'Cuci & Servis', 'unit', false, {
          kind: 'service',
          capacity: 'pk_05_1',
          durationMinutes: 45,
        }),
        tpl('Cuci AC Split 1,5–2 PK', 'Cuci & Servis', 'unit', false, {
          kind: 'service',
          capacity: 'pk_15_2',
          durationMinutes: 60,
        }),
        tpl('Servis Besar / Overhaul AC', 'Cuci & Servis', 'unit', false, {
          kind: 'service',
          capacity: 'all',
          durationMinutes: 120,
        }),
        tpl('Isi Freon R32', 'Perbaikan', 'unit', false, { kind: 'service', capacity: 'all', durationMinutes: 30 }),
        tpl('Pasang AC Baru', 'Pemasangan & Bongkar', 'unit', false, {
          kind: 'service',
          capacity: 'all',
          durationMinutes: 180,
        }),
        tpl('Bongkar AC Split', 'Pemasangan & Bongkar', 'unit', false, {
          kind: 'service',
          capacity: 'all',
          durationMinutes: 60,
        }),
        tpl('Pipa Tembaga + Instalasi', 'Pemasangan & Bongkar', 'meter', false, { kind: 'service', capacity: 'all' }),
        tpl('Kapasitor AC', 'Freon & Sparepart', 'pcs', true, { kind: 'part' }),
        tpl('Remote AC Universal', 'Freon & Sparepart', 'pcs', true, { kind: 'part' }),
      ],
    },
    {
      id: 'laundry',
      label: 'Laundry',
      description: 'Kiloan, satuan, bed cover, selimut, karpet, dan sepatu.',
      icon: 'shirt',
      vocabulary: {
        namePlaceholder: 'Contoh: Cuci Kiloan Reguler',
        skuPlaceholder: 'Contoh: LDR-001',
        variantHint: 'Contoh: pewangi, antar-jemput, bungkus plastik.',
        variantGroupPlaceholder: 'Nama grup (mis. Pewangi)',
        variantOptionPlaceholder: 'Opsi (mis. Lavender)',
        notePlaceholder: 'Contoh: tanpa pewangi, ada noda di lengan kemeja...',
      },
      units: [
        unit('kg', 'Kg', true),
        unit('pcs', 'Pcs'),
        unit('set', 'Set'),
        unit('m2', 'm²', true),
        unit('paket', 'Paket'),
      ],
      defaultUnit: 'kg',
      categories: [
        cat('Kiloan', 'shirt', '#3b82f6'),
        cat('Satuan', 'shirt', '#8b5cf6'),
        cat('Bedding & Karpet', 'bed', '#10b981'),
        cat('Tambahan', 'sparkles', '#eab308'),
      ],
      fields: [
        {
          key: 'speed',
          label: 'Kecepatan Layanan',
          type: 'select',
          options: [
            opt('regular', 'Reguler (2–3 hari)'),
            opt('express', 'Express (1 hari)'),
            opt('rush', 'Kilat (beberapa jam)'),
          ],
        },
        {
          key: 'turnaroundHours',
          label: 'Estimasi Selesai',
          type: 'number',
          min: 1,
          max: 720,
          unit: 'jam',
          placeholder: 'Contoh: 48',
          help: 'Dipakai sebagai perkiraan selesai saat transaksi dibuat.',
        },
        {
          key: 'includes',
          label: 'Termasuk',
          type: 'multiselect',
          options: [opt('wash', 'Cuci'), opt('dry', 'Kering'), opt('iron', 'Setrika'), opt('fold', 'Lipat')],
        },
      ],
      variantPresets: [
        preset('Pewangi', ['Standar', 'Lavender', 'Lemon']),
        preset('Layanan Tambahan', ['Antar-Jemput', 'Bungkus Plastik'], false, true),
      ],
      templates: [
        tpl('Cuci Kiloan Reguler (Cuci + Setrika)', 'Kiloan', 'kg', false, {
          speed: 'regular',
          turnaroundHours: 72,
          includes: ['wash', 'dry', 'iron', 'fold'],
        }),
        tpl('Cuci Kiloan Express (Cuci + Setrika)', 'Kiloan', 'kg', false, {
          speed: 'express',
          turnaroundHours: 24,
          includes: ['wash', 'dry', 'iron', 'fold'],
        }),
        tpl('Cuci Kiloan Kilat (Cuci + Setrika)', 'Kiloan', 'kg', false, {
          speed: 'rush',
          turnaroundHours: 6,
          includes: ['wash', 'dry', 'iron', 'fold'],
        }),
        tpl('Cuci Lipat Saja', 'Kiloan', 'kg', false, {
          speed: 'regular',
          turnaroundHours: 48,
          includes: ['wash', 'dry', 'fold'],
        }),
        tpl('Setrika Saja', 'Kiloan', 'kg', false, {
          speed: 'regular',
          turnaroundHours: 24,
          includes: ['iron', 'fold'],
        }),
        tpl('Kemeja / Blus', 'Satuan', 'pcs', false, { turnaroundHours: 48 }),
        tpl('Celana', 'Satuan', 'pcs', false, { turnaroundHours: 48 }),
        tpl('Jas / Blazer', 'Satuan', 'pcs', false, { turnaroundHours: 72 }),
        tpl('Gaun / Dress', 'Satuan', 'pcs', false, { turnaroundHours: 72 }),
        tpl('Cuci Sepatu', 'Satuan', 'pcs', false, { turnaroundHours: 72 }),
        tpl('Selimut', 'Bedding & Karpet', 'pcs', false, { turnaroundHours: 72 }),
        tpl('Bed Cover', 'Bedding & Karpet', 'pcs', false, { turnaroundHours: 72 }),
        tpl('Springbed / Kasur', 'Bedding & Karpet', 'pcs', false, { turnaroundHours: 96 }),
        tpl('Karpet (per m²)', 'Bedding & Karpet', 'm2', false, { turnaroundHours: 96 }),
      ],
    },
    {
      id: 'workshop',
      label: 'Bengkel Motor / Mobil',
      description: 'Servis rutin, ganti oli, tambal ban, dan sparepart.',
      icon: 'wrench',
      vocabulary: {
        namePlaceholder: 'Contoh: Ganti Oli Motor',
        skuPlaceholder: 'Contoh: BKL-001',
        variantHint: 'Contoh: jenis kendaraan, tambahan servis.',
        variantGroupPlaceholder: 'Nama grup (mis. Jenis Kendaraan)',
        variantOptionPlaceholder: 'Opsi (mis. Motor Matic)',
        notePlaceholder: 'Contoh: plat nomor B 1234 XYZ, rem berbunyi...',
      },
      units: [
        unit('kali', 'Kali / Servis'),
        unit('pcs', 'Pcs'),
        unit('set', 'Set'),
        unit('botol', 'Botol'),
        unit('paket', 'Paket'),
        unit('jam', 'Jam', true),
      ],
      defaultUnit: 'kali',
      categories: [
        cat('Servis Rutin', 'wrench', '#3b82f6'),
        cat('Perbaikan', 'hammer', '#f97316'),
        cat('Ban & Velg', 'circle-dot', '#64748b'),
        cat('Sparepart', 'package', '#10b981'),
        cat('Oli & Cairan', 'droplet', '#eab308'),
      ],
      fields: [
        kindField('part', 'Jasa', 'Sparepart / Barang'),
        {
          key: 'vehicleType',
          label: 'Jenis Kendaraan',
          type: 'select',
          options: [opt('motor', 'Motor'), opt('car', 'Mobil'), opt('both', 'Motor & Mobil')],
        },
        {
          key: 'durationMinutes',
          label: 'Estimasi Pengerjaan',
          type: 'number',
          min: 1,
          max: 1440,
          unit: 'menit',
          placeholder: 'Contoh: 30',
          showWhen: isService,
        },
        { ...WARRANTY_DAYS, showWhen: isService },
        {
          key: 'partBrand',
          label: 'Merek',
          type: 'text',
          maxLength: 60,
          placeholder: 'Contoh: Federal Oil',
          showWhen: { field: 'kind', equals: 'part' },
        },
        {
          key: 'partNumber',
          label: 'Nomor Part',
          type: 'text',
          maxLength: 60,
          showWhen: { field: 'kind', equals: 'part' },
        },
      ],
      variantPresets: [
        preset('Jenis Kendaraan', ['Motor Matic', 'Motor Bebek / Sport', 'Mobil']),
        preset('Tambahan', ['Ganti Oli', 'Servis Rem', 'Cuci'], false, true),
      ],
      templates: [
        tpl('Servis Rutin Motor', 'Servis Rutin', 'kali', false, {
          kind: 'service',
          vehicleType: 'motor',
          durationMinutes: 60,
        }),
        tpl('Ganti Oli Motor', 'Servis Rutin', 'kali', false, {
          kind: 'service',
          vehicleType: 'motor',
          durationMinutes: 15,
        }),
        tpl('Tune Up Motor', 'Servis Rutin', 'kali', false, {
          kind: 'service',
          vehicleType: 'motor',
          durationMinutes: 90,
        }),
        tpl('Servis Berkala Mobil', 'Servis Rutin', 'kali', false, {
          kind: 'service',
          vehicleType: 'car',
          durationMinutes: 180,
        }),
        tpl('Tambal Ban Tubeless', 'Ban & Velg', 'kali', false, {
          kind: 'service',
          vehicleType: 'both',
          durationMinutes: 15,
        }),
        tpl('Tambal Ban Dalam', 'Ban & Velg', 'kali', false, {
          kind: 'service',
          vehicleType: 'both',
          durationMinutes: 20,
        }),
        tpl('Spooring & Balancing', 'Ban & Velg', 'kali', false, {
          kind: 'service',
          vehicleType: 'car',
          durationMinutes: 60,
        }),
        tpl('Ganti Kampas Rem', 'Perbaikan', 'kali', false, {
          kind: 'service',
          vehicleType: 'both',
          durationMinutes: 45,
        }),
        tpl('Oli Mesin Motor 1 Liter', 'Oli & Cairan', 'botol', true, { kind: 'part' }),
        tpl('Busi', 'Sparepart', 'pcs', true, { kind: 'part' }),
        tpl('Kampas Rem Depan', 'Sparepart', 'set', true, { kind: 'part' }),
        tpl('Aki / Baterai', 'Sparepart', 'pcs', true, { kind: 'part' }),
      ],
    },
    {
      id: 'massage',
      label: 'Pijat & Refleksi',
      description: 'Pijat, refleksi, bekam, dan terapi.',
      icon: 'hand',
      vocabulary: {
        namePlaceholder: 'Contoh: Pijat Refleksi 60 Menit',
        skuPlaceholder: 'Contoh: PJT-001',
        variantHint: 'Contoh: aromaterapi, kompres hangat, totok wajah.',
        variantGroupPlaceholder: 'Nama grup (mis. Tambahan)',
        variantOptionPlaceholder: 'Opsi (mis. Aromaterapi)',
        notePlaceholder: 'Contoh: fokus di bahu, tekanan ringan...',
      },
      units: [unit('sesi', 'Sesi'), unit('paket', 'Paket'), unit('pcs', 'Pcs'), unit('jam', 'Jam', true)],
      defaultUnit: 'sesi',
      categories: [
        cat('Pijat', 'hand', '#10b981'),
        cat('Refleksi & Terapi', 'footprints', '#3b82f6'),
        cat('Paket', 'package', '#8b5cf6'),
        cat('Tambahan', 'sparkles', '#eab308'),
      ],
      fields: [
        {
          key: 'durationMinutes',
          label: 'Durasi',
          type: 'number',
          required: true,
          min: 1,
          max: 480,
          unit: 'menit',
          placeholder: 'Contoh: 60',
        },
        {
          key: 'bodyArea',
          label: 'Bagian Tubuh',
          type: 'select',
          options: [
            opt('full_body', 'Seluruh badan'),
            opt('back_shoulder', 'Punggung & bahu'),
            opt('foot', 'Kaki / refleksi'),
            opt('head_face', 'Kepala & wajah'),
            opt('other', 'Lainnya'),
          ],
        },
      ],
      variantPresets: [preset('Tambahan', ['Aromaterapi', 'Kompres Hangat', 'Totok Wajah'], false, true)],
      templates: [
        tpl('Pijat Full Body 60 Menit', 'Pijat', 'sesi', false, { durationMinutes: 60, bodyArea: 'full_body' }),
        tpl('Pijat Full Body 90 Menit', 'Pijat', 'sesi', false, { durationMinutes: 90, bodyArea: 'full_body' }),
        tpl('Pijat Punggung & Bahu 30 Menit', 'Pijat', 'sesi', false, {
          durationMinutes: 30,
          bodyArea: 'back_shoulder',
        }),
        tpl('Refleksi Kaki 45 Menit', 'Refleksi & Terapi', 'sesi', false, { durationMinutes: 45, bodyArea: 'foot' }),
        tpl('Kerokan', 'Refleksi & Terapi', 'sesi', false, { durationMinutes: 30, bodyArea: 'back_shoulder' }),
        tpl('Bekam', 'Refleksi & Terapi', 'sesi', false, { durationMinutes: 45, bodyArea: 'back_shoulder' }),
        tpl('Totok Wajah', 'Tambahan', 'sesi', false, { durationMinutes: 30, bodyArea: 'head_face' }),
      ],
    },
    {
      id: 'printing',
      label: 'Percetakan & Fotokopi',
      description: 'Print, fotokopi, jilid, laminating, banner, dan cetak promosi.',
      icon: 'printer',
      vocabulary: {
        namePlaceholder: 'Contoh: Print Warna A4',
        skuPlaceholder: 'Contoh: PRN-001',
        variantHint: 'Contoh: finishing, jenis kertas.',
        variantGroupPlaceholder: 'Nama grup (mis. Finishing)',
        variantOptionPlaceholder: 'Opsi (mis. Laminating)',
        notePlaceholder: 'Contoh: cetak bolak-balik, file dikirim via WhatsApp...',
      },
      units: [
        unit('lembar', 'Lembar'),
        unit('pcs', 'Pcs'),
        unit('set', 'Set'),
        unit('box', 'Box'),
        unit('rim', 'Rim'),
        unit('m2', 'm²', true),
      ],
      defaultUnit: 'lembar',
      categories: [
        cat('Print & Fotokopi', 'printer', '#3b82f6'),
        cat('Finishing', 'layers', '#8b5cf6'),
        cat('Banner & Spanduk', 'flag', '#f97316'),
        cat('Cetak Promosi', 'file-text', '#ec4899'),
        cat('ATK', 'pencil', '#10b981'),
      ],
      fields: [
        kindField('goods', 'Jasa cetak', 'Barang / ATK'),
        {
          key: 'paperSize',
          label: 'Ukuran Kertas',
          type: 'select',
          options: [
            opt('a5', 'A5'),
            opt('a4', 'A4'),
            opt('a3', 'A3'),
            opt('f4', 'F4 / Folio'),
            opt('other', 'Lainnya'),
          ],
          showWhen: isService,
        },
        {
          key: 'colorMode',
          label: 'Warna Cetak',
          type: 'select',
          options: [opt('bw', 'Hitam putih'), opt('color', 'Warna')],
          showWhen: isService,
        },
        {
          key: 'turnaroundHours',
          label: 'Estimasi Selesai',
          type: 'number',
          min: 1,
          max: 720,
          unit: 'jam',
          placeholder: 'Contoh: 2',
          showWhen: isService,
        },
      ],
      variantPresets: [
        preset('Finishing', ['Tanpa Finishing', 'Laminating', 'Jilid Spiral', 'Jilid Lem']),
        preset('Jenis Kertas', ['HVS 70 gr', 'HVS 80 gr', 'Art Paper']),
      ],
      templates: [
        tpl('Print Hitam Putih A4', 'Print & Fotokopi', 'lembar', false, {
          kind: 'service',
          paperSize: 'a4',
          colorMode: 'bw',
        }),
        tpl('Print Warna A4', 'Print & Fotokopi', 'lembar', false, {
          kind: 'service',
          paperSize: 'a4',
          colorMode: 'color',
        }),
        tpl('Fotokopi A4', 'Print & Fotokopi', 'lembar', false, { kind: 'service', paperSize: 'a4', colorMode: 'bw' }),
        tpl('Fotokopi F4', 'Print & Fotokopi', 'lembar', false, { kind: 'service', paperSize: 'f4', colorMode: 'bw' }),
        tpl('Jilid Spiral', 'Finishing', 'pcs', false, { kind: 'service', turnaroundHours: 2 }),
        tpl('Laminating A4', 'Finishing', 'lembar', false, { kind: 'service', paperSize: 'a4' }),
        tpl('Cetak Banner / Spanduk (per m²)', 'Banner & Spanduk', 'm2', false, {
          kind: 'service',
          turnaroundHours: 24,
        }),
        tpl('Kartu Nama (per box)', 'Cetak Promosi', 'box', false, { kind: 'service', turnaroundHours: 48 }),
        tpl('Undangan', 'Cetak Promosi', 'pcs', false, { kind: 'service', turnaroundHours: 72 }),
        tpl('Kertas HVS A4 70 gr', 'ATK', 'rim', true, { kind: 'goods' }),
        tpl('Pulpen', 'ATK', 'pcs', true, { kind: 'goods' }),
      ],
    },
    {
      id: 'general_service',
      label: 'Jasa Umum',
      description: 'Jasa lain yang tidak termasuk pilihan di atas.',
      icon: 'briefcase',
      vocabulary: {
        variantHint: 'Contoh: antar-jemput, layanan express.',
        variantGroupPlaceholder: 'Nama grup (mis. Opsi Tambahan)',
        variantOptionPlaceholder: 'Opsi (mis. Express)',
        notePlaceholder: 'Contoh: alamat panggilan, jam kedatangan...',
      },
      units: [
        unit('kali', 'Kali'),
        unit('jam', 'Jam', true),
        unit('hari', 'Hari'),
        unit('pcs', 'Pcs'),
        unit('paket', 'Paket'),
      ],
      defaultUnit: 'kali',
      categories: [cat('Jasa Umum', 'briefcase', '#3b82f6'), cat('Lainnya', 'package', '#64748b')],
      fields: [
        {
          key: 'durationMinutes',
          label: 'Estimasi Pengerjaan',
          type: 'number',
          min: 1,
          max: 10080,
          unit: 'menit',
          placeholder: 'Contoh: 60',
        },
        WARRANTY_DAYS,
        {
          key: 'terms',
          label: 'Ketentuan Layanan',
          type: 'textarea',
          maxLength: 500,
          placeholder: 'Contoh: Garansi 7 hari, tidak termasuk sparepart.',
        },
      ],
      variantPresets: [preset('Opsi Tambahan', ['Antar-Jemput', 'Layanan Express'], false, true)],
      templates: [
        tpl('Jasa Servis Panggilan', 'Jasa Umum', 'kali', false, { durationMinutes: 60 }),
        tpl('Jasa Per Jam', 'Jasa Umum', 'jam', false),
        tpl('Biaya Transport / Antar', 'Lainnya', 'kali', false),
        tpl('Paket Layanan', 'Jasa Umum', 'paket', false),
      ],
    },
  ],
});

export const SECTORS: readonly SectorConfig[] = [GENERAL, CULINARY, SERVICE];

const byId = new Map(SECTORS.map(sector => [sector.id, sector]));

export function getSectorConfig(id: BusinessSector): SectorConfig {
  const config = byId.get(id);
  // Unreachable while every enum value has a config (a unit test enforces it).
  if (!config) throw new Error(`No sector config for "${id}"`);
  return config;
}

/** `default` (and anything unknown) resolves to the sector's default kind. */
export function getSubtypeConfig(sectorId: BusinessSector, subtypeId: string): SubtypeConfig {
  const sector = getSectorConfig(sectorId);
  const wanted = subtypeId === 'default' ? sector.defaultSubtype : subtypeId;
  return (
    sector.subtypes.find(subtype => subtype.id === wanted) ??
    sector.subtypes.find(subtype => subtype.id === sector.defaultSubtype)!
  );
}

/** True when `subtypeId` is `default` or one of the sector's kinds. */
export function isValidSubtype(sectorId: BusinessSector, subtypeId: string): boolean {
  return subtypeId === 'default' || getSectorConfig(sectorId).subtypes.some(subtype => subtype.id === subtypeId);
}
