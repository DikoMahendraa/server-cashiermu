import { z } from 'zod';

export const updateStoreSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  logoUrl: z.string().nullable().optional(),
  receiptHeader: z.string().optional(),
  receiptFooter: z.string().optional(),
  taxEnabled: z.boolean().optional(),
  taxRate: z.coerce.number().min(0).max(1).optional(),
  serviceChargeEnabled: z.boolean().optional(),
  serviceChargeRate: z.coerce.number().min(0).max(1).optional(),
  currency: z.string().optional(),
  currencySymbol: z.string().optional(),
  shiftEnabled: z.boolean().optional(),
  shiftRequireOpeningBalance: z.boolean().optional(),
  shiftBranchSelection: z.boolean().optional(),
  globalDiscountEnabled: z.boolean().optional(),
  globalDiscountType: z.enum(['percent', 'amount']).optional(),
  globalDiscountValue: z.coerce.number().min(0).optional(),
  cashierCanDiscount: z.boolean().optional(),
});

export type UpdateStoreDto = z.infer<typeof updateStoreSchema>;
