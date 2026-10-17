import { z } from 'zod';

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
