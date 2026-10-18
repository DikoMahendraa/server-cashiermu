import { z } from 'zod';
import { JOB_STATUSES } from './job';

// Indonesian numbers are typed many ways (0812-3456, +62 812 3456, (021) 555); keep it loose, but 8–15 digits.
const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9+()\-\s]*$/, 'Nomor telepon hanya boleh berisi angka, +, -, spasi dan tanda kurung')
  .refine(value => value === '' || (value.replace(/\D/g, '').length >= 8 && value.replace(/\D/g, '').length <= 15), {
    message: 'Nomor telepon harus 8-15 digit',
  });

// Only `optionId` matters: the server looks the option up and prices it from the database.
// The other fields are what older app versions send; they are accepted and ignored.
const selectedVariantSchema = z.object({
  optionId: z.string(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  optionLabel: z.string().optional(),
  priceModifier: z.coerce.number().optional(),
});

const percentAtMost100 = (d: { type: string; value: number }) => d.type !== 'percent' || d.value <= 100;
const percentMessage = { message: 'Diskon persen maksimal 100', path: ['value'] };

const itemDiscountSchema = z
  .object({
    type: z.enum(['percent', 'nominal']),
    value: z.coerce.number().min(0),
    label: z.string().default(''),
  })
  .refine(percentAtMost100, percentMessage)
  .nullable()
  .optional();

const transactionItemSchema = z.object({
  productId: z.string().uuid(),
  // Whole numbers, or up to 3 decimals for items marked allowDecimalQty (checked against the product at checkout)
  quantity: z.coerce
    .number()
    .positive()
    .max(1_000_000)
    .refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, {
      message: 'Maksimal 3 angka di belakang koma',
    }),
  // Client-displayed values: the server recomputes both and rejects a stale unitPrice.
  unitPrice: z.coerce.number().min(0),
  subtotal: z.coerce.number().min(0).optional(),
  selectedVariants: z.array(selectedVariantSchema).default([]),
  note: z.string().default(''),
  itemDiscount: itemDiscountSchema,
});

const discountSchema = z
  .object({
    type: z.enum(['percent', 'nominal']),
    value: z.coerce.number().min(0),
    label: z.string().default(''),
    code: z.string().nullable().optional(),
  })
  .refine(percentAtMost100, percentMessage);

const paymentSchema = z.object({
  method: z.enum(['cash', 'qris', 'transfer', 'debit_card', 'credit_card']),
  amount: z.coerce.number().min(0),
  reference: z.string().nullable().optional(),
});

/** Present only when the app sends a sale that was rung up offline (see docs/12-offline-sales.md). */
export const offlineSaleSchema = z.object({
  /** When the sale really happened, by the device clock. */
  createdAt: z.coerce.date(),
  /** The temporary receipt number the device showed the customer. */
  receiptNumber: z.string().trim().min(1).max(40),
});

export const createTransactionSchema = z.object({
  shiftId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().optional(),
  customerName: z.string().default(''),
  // Service stores only; ignored for other business types
  customerPhone: phoneSchema.default(''),
  dueAt: z.coerce.date().nullable().optional(),
  note: z.string().default(''),
  items: z.array(transactionItemSchema).min(1),
  offline: offlineSaleSchema.optional(),
  discount: discountSchema.optional(),
  payments: z.array(paymentSchema).min(1),
  // Deprecated: cash tendered is derived from cash payment entries. Accepted for older app builds.
  cashPaid: z.coerce.number().min(0).default(0),
});

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export const voidTransactionSchema = z.object({
  ownerPin: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
  reason: z.string().min(1),
});

export const updateJobSchema = z
  .object({
    jobStatus: z.enum(JOB_STATUSES).optional(),
    dueAt: z.coerce.date().nullable().optional(),
    customerName: z.string().trim().max(100).optional(),
    customerPhone: phoneSchema.optional(),
  })
  .refine(value => Object.keys(value).length > 0, { message: 'Tidak ada yang diubah' });

export type UpdateJobDto = z.infer<typeof updateJobSchema>;
export type CreateTransactionDto = z.infer<typeof createTransactionSchema>;
export type VoidTransactionDto = z.infer<typeof voidTransactionSchema>;
