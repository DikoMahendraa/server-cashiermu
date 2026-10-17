import type { Request, Response } from 'express';
import { SECTORS, SECTOR_CONFIG_VERSION } from './sector.config';

/**
 * GET /sectors — the sector list and every sector's form definition.
 * Public on purpose: the registration screen needs it before anyone has an account, and it contains
 * no store data (it is the same for everybody). Cached for an hour.
 */
export const listSectors = (_req: Request, res: Response): void => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ version: SECTOR_CONFIG_VERSION, sectors: SECTORS });
};
