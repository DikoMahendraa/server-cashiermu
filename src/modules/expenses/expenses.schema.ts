import { z } from 'zod';
import { EXPENSE_CATEGORIES } from './expense.categories';

const MAX_AMOUNT = 100_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const amount = z.coerce
  .number()
  .positive('Jumlah harus lebih dari 0')
  .max(MAX_AMOUNT, 'Jumlah terlalu besar')
  // Rupiah has no cents in practice, but the column keeps 2 decimals
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Maksimal 2 angka di belakang koma',
  });

// A day or so in the future is fine (time zones); further than that is almost certainly a typo.
const spentAt = z.coerce.date().refine(date => date.getTime() <= Date.now() + ONE_DAY_MS, {
  message: 'Tanggal pengeluaran tidak boleh di masa depan',
});

export const createExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount,
  note: z.string().trim().max(200).default(''),
  spentAt: spentAt.default(() => new Date()),
  branchId: z.string().uuid().nullable().optional(),
});

export const updateExpenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES),
    amount,
    note: z.string().trim().max(200),
    spentAt,
    branchId: z.string().uuid().nullable(),
  })
  .partial()
  .refine(value => Object.keys(value).length > 0, { message: 'Tidak ada yang diubah' });

export const listExpensesQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  branchId: z.string().uuid().optional(),
});

export type CreateExpenseDto = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseDto = z.infer<typeof updateExpenseSchema>;
