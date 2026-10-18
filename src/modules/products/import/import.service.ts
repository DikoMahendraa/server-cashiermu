import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../../utils/app-error';
import { getSubtypeConfig } from '../../sectors/sector.config';
import type { SubtypeConfig } from '../../sectors/sector.types';
import { buildImportColumns, type ImportColumn } from './import.columns';
import { productToRow, templateExampleRows, type FileRow } from './import.format';
import { planImport, MAX_IMPORT_ROWS, type ExistingProduct, type ImportPlan } from './import.plan';
import type { ImportBody } from './import.schema';

interface StoreImportContext {
  kind: SubtypeConfig;
  columns: ImportColumn[];
  products: (ExistingProduct & { categoryName: string })[];
  categories: { id: string; name: string }[];
}

/** Everything the import needs to know about the store, always scoped by storeId. */
async function loadContext(db: PrismaClient, storeId: string): Promise<StoreImportContext> {
  const [store, products, categories] = await Promise.all([
    db.store.findUnique({ where: { id: storeId }, select: { sector: true, subtype: true } }),
    db.product.findMany({
      where: { storeId },
      select: {
        id: true,
        sku: true,
        name: true,
        categoryId: true,
        unit: true,
        sellPrice: true,
        buyPrice: true,
        stock: true,
        minStock: true,
        barcode: true,
        isActive: true,
        trackStock: true,
        allowDecimalQty: true,
        attributes: true,
      },
      orderBy: { name: 'asc' },
    }),
    db.category.findMany({ where: { storeId }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
  ]);

  const kind = getSubtypeConfig(store?.sector ?? 'general', store?.subtype ?? 'default');
  const categoryName = new Map(categories.map(category => [category.id, category.name]));
  return {
    kind,
    columns: buildImportColumns(kind),
    categories,
    products: products.map(product => ({
      ...product,
      sellPrice: Number(product.sellPrice),
      buyPrice: Number(product.buyPrice),
      attributes: (product.attributes ?? {}) as Record<string, unknown>,
      categoryName: categoryName.get(product.categoryId) ?? '',
    })),
  };
}

const NOTES = [
  'Isi data mulai dari baris ke-2. Baris contoh boleh dihapus atau ditimpa.',
  'Kolom bertanda * wajib diisi untuk item BARU. Untuk memperbarui item yang sudah ada, cukup isi SKU dan kolom yang ingin diubah.',
  'SKU yang sudah ada di usaha Anda akan DIPERBARUI (bukan dibuat ganda). SKU kosong dibuat otomatis dari nama.',
  'Kategori yang belum ada dibuat otomatis. Varian belum bisa diimpor; atur varian di form produk.',
  `Maksimal ${MAX_IMPORT_ROWS} baris per file. Baris yang salah dilewati dan dilaporkan; baris yang benar tetap diimpor.`,
  'Harga: angka saja, mis. 15000 (boleh "Rp 15.000"). Pilihan (satuan, jenis, dll.) ditulis seperti pada kolom Petunjuk.',
];

function describeColumns(columns: ImportColumn[]) {
  return columns.map(column => ({
    key: column.key,
    header: column.header,
    required: column.required,
    type: column.type,
    help: column.help,
    ...(column.options ? { options: column.options.map(option => option.label) } : {}),
  }));
}

export async function buildTemplate(db: PrismaClient, storeId: string) {
  const { kind, columns, categories } = await loadContext(db, storeId);
  return {
    sheetName: kind.vocabulary.item,
    kind: { id: kind.id, label: kind.label },
    columns: describeColumns(columns),
    examples: templateExampleRows(kind, columns),
    categories: categories.map(category => category.name),
    notes: NOTES,
  };
}

export async function buildExport(db: PrismaClient, storeId: string) {
  const { kind, columns, products } = await loadContext(db, storeId);
  const rows: FileRow[] = products.map(product => productToRow(columns, product));
  return { sheetName: kind.vocabulary.item, columns: describeColumns(columns), rows, total: rows.length };
}

function toResponse(plan: ImportPlan) {
  return {
    summary: plan.summary,
    newCategories: plan.newCategories,
    ignoredColumns: plan.ignoredHeaders,
    rows: plan.rows.map(row => ({
      rowNumber: row.rowNumber,
      action: row.action,
      sku: row.sku,
      name: row.name,
      changes: row.changes,
      errors: row.errors,
    })),
  };
}

async function makePlan(db: PrismaClient, storeId: string, body: ImportBody): Promise<ImportPlan> {
  const context = await loadContext(db, storeId);
  const plan = planImport({
    kind: context.kind,
    columns: context.columns,
    headers: body.headers,
    rows: body.rows,
    existing: context.products,
    categories: context.categories,
  });
  if (plan.fatal) throw new AppError(422, plan.fatal.code, plan.fatal.message, { ignoredColumns: plan.ignoredHeaders });
  return plan;
}

/** Shows what an import would do. Writes nothing. */
export async function previewImport(db: PrismaClient, storeId: string, body: ImportBody) {
  return { dryRun: true, ...toResponse(await makePlan(db, storeId, body)) };
}

/**
 * Applies an import. The plan is computed again here (a preview is never trusted), and everything valid is written in
 * ONE transaction: new categories, new items, updates. Rows with errors are skipped and reported.
 */
export async function commitImport(db: PrismaClient, storeId: string, body: ImportBody) {
  const plan = await makePlan(db, storeId, body);
  const creates = plan.rows.filter(row => row.action === 'create');
  const updates = plan.rows.filter(row => row.action === 'update');

  const applied = await db.$transaction(
    async tx => {
      const categoryIdByName = new Map(
        (await tx.category.findMany({ where: { storeId }, select: { id: true, name: true } })).map(c => [
          c.name.trim().toLowerCase(),
          c.id,
        ]),
      );

      let nextOrder =
        ((await tx.category.aggregate({ where: { storeId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 1;
      for (const name of plan.newCategories) {
        const created = await tx.category.create({
          data: { storeId, name, icon: 'package', color: '#64748b', sortOrder: nextOrder++ },
        });
        categoryIdByName.set(name.trim().toLowerCase(), created.id);
      }
      const categoryId = (name: string | undefined): string => {
        const id = name ? categoryIdByName.get(name.trim().toLowerCase()) : undefined;
        if (!id) throw new AppError(422, 'CATEGORY_NOT_FOUND', 'Kategori tidak ditemukan');
        return id;
      };

      if (creates.length > 0) {
        await tx.product.createMany({
          data: creates.map(({ write }) => ({
            storeId,
            sku: write!.sku,
            name: write!.name!,
            categoryId: categoryId(write!.categoryName),
            sellPrice: write!.sellPrice!,
            buyPrice: write!.buyPrice!,
            unit: write!.unit!,
            trackStock: write!.trackStock!,
            allowDecimalQty: write!.allowDecimalQty!,
            stock: write!.stock!,
            minStock: write!.minStock!,
            barcode: write!.barcode ?? null,
            isActive: write!.isActive!,
            attributes: (write!.attributes ?? {}) as Prisma.InputJsonObject,
          })),
        });
      }

      for (const { existingId, write } of updates) {
        if (!existingId || !write) continue;
        const { sku: _sku, categoryName, attributes, ...fields } = write;
        await tx.product.update({
          where: { id: existingId, storeId },
          data: {
            ...fields,
            ...(categoryName ? { categoryId: categoryId(categoryName) } : {}),
            ...(attributes ? { attributes: attributes as Prisma.InputJsonObject } : {}),
          },
        });
      }

      return { created: creates.length, updated: updates.length, categoriesCreated: plan.newCategories.length };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return { dryRun: false, applied, ...toResponse(plan) };
}
