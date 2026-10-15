import { z } from 'zod';

const selectedVariantSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  optionId: z.string(),
  optionLabel: z.string(),
  priceModifier: z.coerce.number(),
});

const itemDiscountSchema = z.object({
  type:  z.enum(['percent', 'nominal']),
  value: z.coerce.number().min(0),
  label: z.string().default(''),
}).nullable().optional();

const transactionItemSchema = z.object({
  productId:        z.string().uuid(),
  quantity:         z.coerce.number().int().positive(),
  unitPrice:        z.coerce.number().min(0),
  subtotal:         z.coerce.number().min(0).optional(),
  selectedVariants: z.array(selectedVariantSchema).default([]),
  note:             z.string().default(''),
  itemDiscount:     itemDiscountSchema,
});

const discountSchema = z.object({
  type: z.enum(['percent', 'nominal']),
  value: z.coerce.number().min(0),
  label: z.string().default(''),
  code: z.string().nullable().optional(),
});

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
  cashPaid: z.coerce.number().min(0).default(0),
});

export const voidTransactionSchema = z.object({
  ownerPin: z.string().length(6).regex(/^\d{6}$/),
  reason: z.string().min(1),
});

export type CreateTransactionDto = z.infer<typeof createTransactionSchema>;
export type VoidTransactionDto = z.infer<typeof voidTransactionSchema>;
