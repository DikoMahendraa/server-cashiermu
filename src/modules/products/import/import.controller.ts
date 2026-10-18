import type { NextFunction, Request, Response } from 'express';
import prisma from '../../../config/database';
import type { ImportBody } from './import.schema';
import { buildExport, buildTemplate, commitImport, previewImport } from './import.service';

const storeId = (req: Request): string => req.user!.storeId;

export const getImportTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await buildTemplate(prisma, storeId(req)));
  } catch (err) {
    next(err);
  }
};

export const exportProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await buildExport(prisma, storeId(req)));
  } catch (err) {
    next(err);
  }
};

export const previewProductImport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await previewImport(prisma, storeId(req), req.body as ImportBody));
  } catch (err) {
    next(err);
  }
};

export const commitProductImport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await commitImport(prisma, storeId(req), req.body as ImportBody));
  } catch (err) {
    next(err);
  }
};
