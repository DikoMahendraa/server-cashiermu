import { BusinessSector } from '@prisma/client';
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
  // Changing the sector keeps existing product data; it only changes which fields new/edited products use.
  sector: z.nativeEnum(BusinessSector).optional(),
  // Kind inside the sector. Sending only `sector` resets the kind to that sector's default.
  subtype: z.string().trim().min(1).max(40).optional(),
});

export type UpdateStoreDto = z.infer<typeof updateStoreSchema>;
