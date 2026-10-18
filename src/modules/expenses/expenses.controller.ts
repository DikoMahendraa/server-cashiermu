import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../utils/app-error';
import { EXPENSE_CATEGORIES, expenseLabel } from './expense.categories';
import { CreateExpenseDto, UpdateExpenseDto, listExpensesQuerySchema } from './expenses.schema';

const MAX_LISTED = 500;

const INCLUDE = {
  branch: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof INCLUDE }>;

const present = (row: ExpenseRow) => ({
  id: row.id,
  category: row.category,
  categoryLabel: expenseLabel(row.category),
  amount: Number(row.amount),
  note: row.note,
  spentAt: row.spentAt,
  branchId: row.branchId,
  branchName: row.branch?.name ?? null,
  recordedBy: row.user.name,
  createdAt: row.createdAt,
});

/** A branch id sent by the client must belong to the caller's store. */
async function assertBranchInStore(storeId: string, branchId: string | null | undefined): Promise<void> {
  if (!branchId) return;
  const branch = await prisma.branch.findFirst({ where: { id: branchId, storeId }, select: { id: true } });
  if (!branch) throw new AppError(422, 'BRANCH_NOT_FOUND', 'Cabang tidak ditemukan');
}

export const listExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listExpensesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(422, 'INVALID_QUERY', 'Parameter tidak valid', parsed.error.flatten());
    }
    const { from, to, category, branchId } = parsed.data;
    const where: Prisma.ExpenseWhereInput = {
      storeId: req.user!.storeId,
      ...(category ? { category } : {}),
      ...(branchId ? { branchId } : {}),
      ...(from || to
        ? { spentAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    };

    // Totals cover everything that matches; the list is capped so a huge range cannot flood the app
    const [rows, byCategoryRows] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ spentAt: 'desc' }, { createdAt: 'desc' }],
        take: MAX_LISTED,
      }),
      prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const byCategory = byCategoryRows
      .map(row => ({
        category: row.category,
        label: expenseLabel(row.category),
        total: Number(row._sum.amount ?? 0),
        count: row._count._all,
      }))
      .sort((a, b) => b.total - a.total);
    const total = byCategory.reduce((sum, row) => sum + row.total, 0);
    const count = byCategory.reduce((sum, row) => sum + row.count, 0);

    res.json({
      items: rows.map(present),
      total,
      count,
      truncated: count > rows.length,
      byCategory,
      categories: EXPENSE_CATEGORIES,
    });
  } catch (err) {
    next(err);
  }
};

export const createExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as CreateExpenseDto;
    await assertBranchInStore(req.user!.storeId, body.branchId);
    const created = await prisma.expense.create({
      data: {
        storeId: req.user!.storeId,
        userId: req.user!.userId,
        category: body.category,
        amount: body.amount,
        note: body.note,
        spentAt: body.spentAt,
        branchId: body.branchId ?? null,
      },
      include: INCLUDE,
    });
    res.status(201).json(present(created));
  } catch (err) {
    next(err);
  }
};

export const updateExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const id = String(req.params['id']);
    const body = req.body as UpdateExpenseDto;

    const existing = await prisma.expense.findFirst({ where: { id, storeId }, select: { id: true } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Pengeluaran tidak ditemukan');
    await assertBranchInStore(storeId, body.branchId);

    const updated = await prisma.expense.update({ where: { id }, data: body, include: INCLUDE });
    res.json(present(updated));
  } catch (err) {
    next(err);
  }
};

export const deleteExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { count } = await prisma.expense.deleteMany({
      where: { id: String(req.params['id']), storeId: req.user!.storeId },
    });
    if (count === 0) throw new AppError(404, 'NOT_FOUND', 'Pengeluaran tidak ditemukan');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
