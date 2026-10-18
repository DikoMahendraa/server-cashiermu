import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../../config/database';
import { getProfitReport } from './profit.service';
import { getEmployeePerformance } from './employee.service';
import { buildExport } from './export.service';
import { EXPORT_DATASETS, type ExportDataset } from './export.report';

function getQueryStr(req: Request, key: string): string | undefined {
  const val = req.query[key];
  return typeof val === 'string' ? val : undefined;
}

export const getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const from = getQueryStr(req, 'from');
    const to = getQueryStr(req, 'to');
    const branchId = getQueryStr(req, 'branchId');

    const where = {
      storeId,
      status: 'paid' as const,
      ...(branchId ? { branchId } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    };

    const [count, agg] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.aggregate({ where, _sum: { grandTotal: true } }),
    ]);

    const totalRevenue = Number(agg._sum.grandTotal || 0);
    const avgOrderValue = count > 0 ? totalRevenue / count : 0;

    res.json({ totalRevenue, transactionCount: count, avgOrderValue });
  } catch (err) {
    next(err);
  }
};

export const getChart = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const period = getQueryStr(req, 'period') || 'week';
    const off = parseInt(getQueryStr(req, 'offset') || '0', 10);
    const now = new Date();

    let from: Date, to: Date, label: string;

    if (period === 'day') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - off);
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
      label = from.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } else if (period === 'month') {
      from = new Date(now.getFullYear(), now.getMonth() - off, 1);
      to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      label = from.toLocaleDateString('id-ID', { year: 'numeric', month: 'long' });
    } else if (period === 'year') {
      from = new Date(now.getFullYear() - off, 0, 1);
      to = new Date(from.getFullYear() + 1, 0, 1);
      label = String(from.getFullYear());
    } else {
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - off * 7);
      monday.setHours(0, 0, 0, 0);
      from = monday;
      to = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
      const end = new Date(to.getTime() - 1);
      label = `Minggu ini (${from.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    }

    const transactions = await prisma.transaction.findMany({
      where: { storeId, status: 'paid', createdAt: { gte: from, lt: to } },
      select: { grandTotal: true, createdAt: true },
    });

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const map = new Map<string, { revenue: number; count: number }>();
    for (const tx of transactions) {
      const key = tx.createdAt.toISOString().slice(0, 10);
      const existing = map.get(key) || { revenue: 0, count: 0 };
      existing.revenue += Number(tx.grandTotal);
      existing.count += 1;
      map.set(key, existing);
    }

    const points: { label: string; date: string; revenue: number; count: number }[] = [];
    const cursor = new Date(from);
    while (cursor < to) {
      const key = cursor.toISOString().slice(0, 10);
      const data = map.get(key) || { revenue: 0, count: 0 };
      points.push({ label: dayNames[cursor.getDay()], date: key, ...data });
      cursor.setDate(cursor.getDate() + 1);
    }

    const totalRevenue = points.reduce((s, p) => s + p.revenue, 0);
    const totalCount = points.reduce((s, p) => s + p.count, 0);

    res.json({ period, offset: off, label, points, totalRevenue, totalCount });
  } catch (err) {
    next(err);
  }
};

export const getTopProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const from = getQueryStr(req, 'from');
    const to = getQueryStr(req, 'to');
    const lim = parseInt(getQueryStr(req, 'limit') || '10', 10);

    const items = await prisma.transactionItem.groupBy({
      by: ['productId', 'productName', 'sku'],
      where: {
        transaction: {
          storeId,
          status: 'paid',
          ...(from || to
            ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
            : {}),
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: lim,
    });

    res.json(
      items.map(i => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        totalQuantity: Number(i._sum.quantity ?? 0),
        totalRevenue: Number(i._sum.subtotal || 0),
      })),
    );
  } catch (err) {
    next(err);
  }
};

export const getPaymentBreakdown = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const from = getQueryStr(req, 'from');
    const to = getQueryStr(req, 'to');

    const payments = await prisma.paymentEntry.groupBy({
      by: ['method'],
      where: {
        transaction: {
          storeId,
          status: 'paid',
          ...(from || to
            ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
            : {}),
        },
      },
      _sum: { amount: true },
      _count: { id: true },
    });

    res.json(
      payments.map(p => ({
        method: p.method,
        total: Number(p._sum.amount || 0),
        count: p._count.id,
      })),
    );
  } catch (err) {
    next(err);
  }
};

export const getShiftSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const from = getQueryStr(req, 'from');
    const to = getQueryStr(req, 'to');
    const branchId = getQueryStr(req, 'branchId');

    const shifts = await prisma.shift.findMany({
      where: {
        storeId,
        ...(branchId ? { branchId } : {}),
        ...(from || to
          ? { startedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { transactions: { where: { status: 'paid' } } } },
      },
      orderBy: { startedAt: 'desc' },
    });
    res.json(shifts);
  } catch (err) {
    next(err);
  }
};

const profitQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  branchId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * GET /reports/profit?from=&to=&branchId=&userId=&limit=
 * from/to are ISO timestamps (e.g. 2026-10-01T00:00:00+07:00): the app decides where a business day starts.
 */
export const getProfit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = profitQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(422)
        .json({ code: 'INVALID_QUERY', message: 'Parameter laporan tidak valid', details: parsed.error.flatten() });
      return;
    }
    const { from, to, ...rest } = parsed.data;
    const report = await getProfitReport(prisma, {
      storeId: req.user!.storeId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      ...rest,
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
};

const periodQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  branchId: z.string().uuid().optional(),
});

function parsePeriod(req: Request, res: Response) {
  const parsed = periodQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(422)
      .json({ code: 'INVALID_QUERY', message: 'Parameter laporan tidak valid', details: parsed.error.flatten() });
    return null;
  }
  const { from, to, branchId } = parsed.data;
  return {
    storeId: req.user!.storeId,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    branchId,
  };
}

/** GET /reports/employee-performance?from=&to=&branchId= */
export const getEmployeePerformanceReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = parsePeriod(req, res);
    if (!query) return;
    res.json(await getEmployeePerformance(prisma, query));
  } catch (err) {
    next(err);
  }
};

/** GET /reports/export/:dataset?from=&to=&branchId= — a plain table the app saves as Excel or CSV. */
export const exportReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dataset = String(req.params['dataset']);
    if (!(EXPORT_DATASETS as readonly string[]).includes(dataset)) {
      res.status(404).json({ code: 'UNKNOWN_DATASET', message: 'Data yang diminta tidak dikenal' });
      return;
    }
    const query = parsePeriod(req, res);
    if (!query) return;
    res.json(await buildExport(prisma, dataset as ExportDataset, query));
  } catch (err) {
    next(err);
  }
};
