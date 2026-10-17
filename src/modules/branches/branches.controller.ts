import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { CreateBranchDto, UpdateBranchDto } from './branches.schema';

export const listBranches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const branches = await prisma.branch.findMany({
      where: { storeId: req.user!.storeId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(branches);
  } catch (err) {
    next(err);
  }
};

export const createBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const branch = await prisma.branch.create({
      data: { ...(req.body as CreateBranchDto), storeId: req.user!.storeId },
    });
    res.status(201).json(branch);
  } catch (err) {
    next(err);
  }
};

export const updateBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const branch = await prisma.branch.update({
      where: { id, storeId: req.user!.storeId },
      data: req.body as UpdateBranchDto,
    });
    res.json(branch);
  } catch (err) {
    next(err);
  }
};

export const toggleStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;

    const branch = await prisma.branch.findUnique({ where: { id, storeId } });
    if (!branch) {
      res.status(404).json({ message: 'Branch not found' });
      return;
    }

    const updated = await prisma.branch.update({
      where: { id, storeId },
      data: { isActive: !branch.isActive },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};
