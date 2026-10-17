import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.schema';

export const listCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({
      where: { storeId: req.user!.storeId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
};

export const createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const category = await prisma.category.create({
      data: { ...(req.body as CreateCategoryDto), storeId: req.user!.storeId },
    });
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
};

export const updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const category = await prisma.category.update({
      where: { id, storeId: req.user!.storeId },
      data: req.body as UpdateCategoryDto,
    });
    res.json(category);
  } catch (err) {
    next(err);
  }
};

export const deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;

    const productCount = await prisma.product.count({ where: { categoryId: id, storeId } });

    if (productCount > 0) {
      const fallback = await prisma.category.findFirst({
        where: { storeId, name: 'Lainnya', NOT: { id } },
        select: { id: true },
      });

      if (!fallback) {
        res.status(400).json({
          message: `Kategori ini memiliki ${productCount} produk. Pindahkan produk ke kategori lain atau buat kategori "Lainnya" terlebih dahulu.`,
        });
        return;
      }

      await prisma.product.updateMany({
        where: { categoryId: id, storeId },
        data: { categoryId: fallback.id },
      });
    }

    await prisma.category.delete({ where: { id, storeId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
