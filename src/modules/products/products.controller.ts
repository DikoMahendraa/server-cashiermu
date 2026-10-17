import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { CreateProductDto, UpdateProductDto, AdjustStockDto } from './products.schema';

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
      include: { category: { select: { id: true, name: true } } },
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
    const { variantGroups, ...productData } = req.body as CreateProductDto;

    const product = await prisma.product.create({
      data: {
        ...productData,
        storeId: req.user!.storeId,
        variantGroups: {
          create: variantGroups.map(vg => ({
            name: vg.name,
            required: vg.required,
            multiSelect: vg.multiSelect,
            sortOrder: vg.sortOrder,
            options: { create: vg.options },
          })),
        },
      },
      include: { variantGroups: { include: { options: true } }, category: true },
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
    const product = await prisma.product.update({
      where: { id, storeId: req.user!.storeId },
      data: req.body as UpdateProductDto,
      include: { category: { select: { id: true, name: true } } },
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
