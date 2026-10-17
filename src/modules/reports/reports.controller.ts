import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';

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
        totalQuantity: i._sum.quantity || 0,
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
