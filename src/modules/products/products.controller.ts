import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { CreateProductDto, UpdateProductDto, AdjustStockDto } from './products.schema';

function stockStatus(stock: number, minStock: number): string {
  if (stock === 0) return 'empty';
  if (stock <= minStock) return 'low';
  return 'safe';
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

    const enriched = products.map(p => ({ ...p, stockStatus: stockStatus(p.stock, p.minStock) }));
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
    next(err);
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
    res.json({ ...product, stockStatus: stockStatus(product.stock, product.minStock) });
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
    res.json({ ...product, stockStatus: stockStatus(product.stock, product.minStock) });
  } catch (err) {
    next(err);
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
    res.json({ ...updated, stockStatus: stockStatus(updated.stock, updated.minStock) });
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
