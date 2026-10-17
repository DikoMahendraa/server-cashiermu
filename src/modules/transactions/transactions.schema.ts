import { z } from 'zod';

const selectedVariantSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  optionId: z.string(),
  optionLabel: z.string(),
  priceModifier: z.coerce.number(),
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
  quantity: z.coerce.number().int().positive(),
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

export const createTransactionSchema = z.object({
  shiftId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().optional(),
  customerName: z.string().default(''),
  note: z.string().default(''),
  items: z.array(transactionItemSchema).min(1),
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

export type CreateTransactionDto = z.infer<typeof createTransactionSchema>;
export type VoidTransactionDto = z.infer<typeof voidTransactionSchema>;
