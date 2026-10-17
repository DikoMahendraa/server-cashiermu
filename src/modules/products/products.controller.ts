import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../utils/app-error';
import { getSubtypeConfig } from '../sectors/sector.config';
import { resolveTrackStockDefault, validateAttributes } from '../sectors/sector.validation';
import { CreateProductDto, UpdateProductDto, AdjustStockDto, type VariantGroupUpdateInput } from './products.schema';

// Untracked products (services, unlimited items) have no stock level, so they are never "low" or "empty".
function stockStatus(product: { stock: number; minStock: number; trackStock: boolean }): string {
  if (!product.trackStock) return 'safe';
  if (product.stock === 0) return 'empty';
  if (product.stock <= product.minStock) return 'low';
  return 'safe';
}

/** SKU and barcode are unique per store; turn the database error into a message the cashier can act on. */
function sendIfDuplicate(err: unknown, res: Response): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = String(err.meta?.['target'] ?? '').toLowerCase();
    if (target.includes('barcode')) {
      res.status(409).json({ code: 'BARCODE_TAKEN', message: 'Barcode sudah dipakai produk lain di toko ini' });
      return true;
    }
    if (target.includes('sku')) {
      res.status(409).json({ code: 'SKU_TAKEN', message: 'SKU sudah dipakai produk lain di toko ini' });
      return true;
    }
  }
  return false;
}

const VARIANTS_INCLUDE = {
  variantGroups: {
    include: { options: { orderBy: { sortOrder: 'asc' as const } } },
    orderBy: { sortOrder: 'asc' as const },
  },
};

/** Validates `attributes` against the store's kind of business. Throws a 422 AppError with one message per field. */
async function checkAttributes(storeId: string, attributes: unknown) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { sector: true, subtype: true } });
  const kind = getSubtypeConfig(store?.sector ?? 'general', store?.subtype ?? 'default');
  const result = validateAttributes(kind, attributes);
  if (!result.ok) {
    throw new AppError(422, 'INVALID_ATTRIBUTES', 'Isian produk tidak valid', { fields: result.errors });
  }
  return { kind, attributes: result.value as Prisma.InputJsonObject };
}

/** Fractional quantities only make sense for items without a stock count (the stock column is whole numbers). */
function assertDecimalRule(trackStock: boolean, allowDecimalQty: boolean): void {
  if (trackStock && allowDecimalQty) {
    throw new AppError(
      422,
      'DECIMAL_NEEDS_UNTRACKED_STOCK',
      'Jumlah desimal hanya bisa untuk item tanpa pelacakan stok',
    );
  }
}

/** A category id from the client must belong to the caller's store (never link another shop's category). */
async function assertCategoryInStore(storeId: string, categoryId: string): Promise<void> {
  const category = await prisma.category.findFirst({ where: { id: categoryId, storeId }, select: { id: true } });
  if (!category) throw new AppError(422, 'CATEGORY_NOT_FOUND', 'Kategori tidak ditemukan di toko ini');
}

/**
 * Makes a product's variant groups match `groups` exactly, keeping the ids of unchanged groups/options so
 * carts and receipts that reference them stay valid.
 */
async function syncVariantGroups(
  tx: Prisma.TransactionClient,
  productId: string,
  groups: VariantGroupUpdateInput[],
): Promise<void> {
  const existing = await tx.variantGroup.findMany({ where: { productId }, include: { options: true } });
  const existingById = new Map(existing.map(group => [group.id, group]));

  for (const group of groups) {
    if (group.id && !existingById.has(group.id)) {
      throw new AppError(422, 'INVALID_VARIANT_ID', 'Grup varian tidak ditemukan pada produk ini');
    }
    const ownOptionIds = new Set(existingById.get(group.id ?? '')?.options.map(option => option.id));
    for (const option of group.options) {
      if (option.id && !ownOptionIds.has(option.id)) {
        throw new AppError(422, 'INVALID_VARIANT_ID', 'Opsi varian tidak ditemukan pada grup ini');
      }
    }
  }

  const keepGroupIds = groups.flatMap(group => (group.id ? [group.id] : []));
  await tx.variantGroup.deleteMany({ where: { productId, id: { notIn: keepGroupIds } } });

  for (const [groupIndex, group] of groups.entries()) {
    const fields = {
      name: group.name,
      required: group.required,
      multiSelect: group.multiSelect,
      sortOrder: groupIndex,
    };

    if (!group.id) {
      await tx.variantGroup.create({
        data: {
          productId,
          ...fields,
          options: {
            create: group.options.map((option, index) => ({
              label: option.label,
              priceModifier: option.priceModifier,
              sortOrder: index,
            })),
          },
        },
      });
      continue;
    }

    await tx.variantGroup.update({ where: { id: group.id }, data: fields });
    const keepOptionIds = group.options.flatMap(option => (option.id ? [option.id] : []));
    await tx.variantOption.deleteMany({ where: { variantGroupId: group.id, id: { notIn: keepOptionIds } } });
    for (const [index, option] of group.options.entries()) {
      const data = { label: option.label, priceModifier: option.priceModifier, sortOrder: index };
      if (option.id) await tx.variantOption.update({ where: { id: option.id }, data });
      else await tx.variantOption.create({ data: { variantGroupId: group.id, ...data } });
    }
  }
}

export const listProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const categoryId = typeof req.query['categoryId'] === 'string' ? req.query['categoryId'] : undefined;
    const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
    const stockFilter = typeof req.query['stockStatus'] === 'string' ? req.query['stockStatus'] : undefined;
    const isActiveParam = typeof req.query['isActive'] === 'string' ? req.query['isActive'] : undefined;

    const products = await prisma.product.findMany({
      where: {
        storeId,
        ...(categoryId ? { categoryId } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(isActiveParam !== undefined ? { isActive: isActiveParam === 'true' } : {}),
      },
      include: { category: { select: { id: true, name: true } }, ...VARIANTS_INCLUDE },
      orderBy: { name: 'asc' },
    });

    const enriched = products.map(p => ({ ...p, stockStatus: stockStatus(p) }));
    const filtered = stockFilter ? enriched.filter(p => p.stockStatus === stockFilter) : enriched;

    res.json(filtered);
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      variantGroups,
      attributes: rawAttributes,
      trackStock,
      allowDecimalQty = false,
      ...productData
    } = req.body as CreateProductDto;
    const storeId = req.user!.storeId;

    await assertCategoryInStore(storeId, productData.categoryId);
    const { kind, attributes } = await checkAttributes(storeId, rawAttributes);
    const finalTrackStock = trackStock ?? resolveTrackStockDefault(kind, attributes);
    assertDecimalRule(finalTrackStock, allowDecimalQty);

    const product = await prisma.product.create({
      data: {
        ...productData,
        attributes,
        trackStock: finalTrackStock,
        allowDecimalQty,
        storeId,
        variantGroups: {
          create: variantGroups.map((vg, groupIndex) => ({
            name: vg.name,
            required: vg.required,
            multiSelect: vg.multiSelect,
            sortOrder: groupIndex,
            options: {
              create: vg.options.map((option, index) => ({
                label: option.label,
                priceModifier: option.priceModifier,
                sortOrder: index,
              })),
            },
          })),
        },
      },
      include: { ...VARIANTS_INCLUDE, category: true },
    });

    res.status(201).json(product);
  } catch (err) {
    if (!sendIfDuplicate(err, res)) next(err);
  }
};

export const getProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const product = await prisma.product.findUnique({
      where: { id, storeId: req.user!.storeId },
      include: {
        variantGroups: { include: { options: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } },
        category: true,
      },
    });
    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }
    res.json({ ...product, stockStatus: stockStatus(product) });
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;
    const { variantGroups, attributes: rawAttributes, ...fields } = req.body as UpdateProductDto;

    if (fields.categoryId) await assertCategoryInStore(storeId, fields.categoryId);

    if (fields.trackStock !== undefined || fields.allowDecimalQty !== undefined) {
      const current = await prisma.product.findFirst({
        where: { id, storeId },
        select: { trackStock: true, allowDecimalQty: true },
      });
      if (current) {
        assertDecimalRule(fields.trackStock ?? current.trackStock, fields.allowDecimalQty ?? current.allowDecimalQty);
      }
    }
    const checked = rawAttributes === undefined ? undefined : await checkAttributes(storeId, rawAttributes);

    const product = await prisma.$transaction(async tx => {
      const updated = await tx.product.update({
        where: { id, storeId },
        data: { ...fields, ...(checked ? { attributes: checked.attributes } : {}) },
      });
      if (variantGroups) await syncVariantGroups(tx, updated.id, variantGroups);
      return tx.product.findUniqueOrThrow({
        where: { id: updated.id },
        include: { category: { select: { id: true, name: true } }, ...VARIANTS_INCLUDE },
      });
    });

    res.json({ ...product, stockStatus: stockStatus(product) });
  } catch (err) {
    if (!sendIfDuplicate(err, res)) next(err);
  }
};

export const adjustStock = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;
    const { adjustment } = req.body as AdjustStockDto;

    const product = await prisma.product.findUnique({ where: { id, storeId } });
    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    if (!product.trackStock) {
      res.status(422).json({
        code: 'STOCK_NOT_TRACKED',
        message: 'Produk ini tidak melacak stok. Aktifkan pelacakan stok terlebih dahulu.',
      });
      return;
    }

    const newStock = product.stock + adjustment;
    if (newStock < 0) {
      res.status(422).json({ message: 'Insufficient stock' });
      return;
    }

    const updated = await prisma.product.update({
      where: { id, storeId },
      data: { stock: newStock },
      include: { category: { select: { id: true, name: true } } },
    });
    res.json({ ...updated, stockStatus: stockStatus(updated) });
  } catch (err) {
    next(err);
  }
};

export const softDeleteProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    await prisma.product.update({ where: { id, storeId: req.user!.storeId }, data: { isActive: false } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
