import { z } from 'zod';

export const createDiscountSchema = z.object({
  label: z.string().min(1).max(60),
  type: z.enum(['percent', 'amount']),
  value: z.coerce.number().min(0),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export const updateDiscountSchema = createDiscountSchema.partial();

export type CreateDiscountDto = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountDto = z.infer<typeof updateDiscountSchema>;
