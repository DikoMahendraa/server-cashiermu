import { z } from 'zod';

const variantOptionFields = {
  label: z.string().trim().min(1).max(60),
  priceModifier: z.coerce.number().min(-1_000_000_000).max(1_000_000_000).default(0),
};

const variantGroupFields = {
  name: z.string().trim().min(1).max(60),
  required: z.boolean().default(false),
  multiSelect: z.boolean().default(false),
};

// Creating: no ids accepted (the server assigns them). Order = position in the array.
const variantGroupSchema = z.object({
  ...variantGroupFields,
  options: z.array(z.object(variantOptionFields)).max(50).default([]),
});

// Updating: send the COMPLETE list. Entries with an `id` are updated, entries without are created,
// and existing groups/options that are missing from the list are deleted.
const variantGroupUpdateSchema = z.object({
  id: z.string().uuid().optional(),
  ...variantGroupFields,
  options: z
    .array(z.object({ id: z.string().uuid().optional(), ...variantOptionFields }))
    .max(50)
    .default([]),
});

export type VariantGroupUpdateInput = z.infer<typeof variantGroupUpdateSchema>;

export const createProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().nullish(),
  categoryId: z.string().min(1),
  buyPrice: z.coerce.number().min(0),
  sellPrice: z.coerce.number().min(0),
  stock: z.coerce.number().int().default(0),
  minStock: z.coerce.number().int().default(5),
  imageUrl: z.string().nullish(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  // false = unlimited stock / service item: never checked or decremented at checkout
  // When omitted the sector's default applies (e.g. services do not track stock)
  trackStock: z.boolean().optional(),
  // Quantity may be fractional (2.5 kg). Only allowed while trackStock is false.
  allowDecimalQty: z.boolean().optional(),
  taxable: z.boolean().default(true),
  unit: z.string().default('pcs'),
  discountEnabled: z.boolean().default(false),
  discountType: z.enum(['percent', 'amount']).default('percent'),
  discountValue: z.coerce.number().min(0).default(0),
  variantGroups: z.array(variantGroupSchema).max(20).default([]),
  // Sector-specific values; validated against the store's sector config in the controller.
  attributes: z.record(z.unknown()).default({}),
});

export const updateProductSchema = createProductSchema
  .omit({ variantGroups: true })
  .partial()
  .extend({ variantGroups: z.array(variantGroupUpdateSchema).max(20).optional() });

export const adjustStockSchema = z.object({
  adjustment: z.coerce.number().int(),
  reason: z.string().optional(),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;
export type UpdateProductDto = z.infer<typeof updateProductSchema>;
export type AdjustStockDto = z.infer<typeof adjustStockSchema>;
