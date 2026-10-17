import type { BusinessSector } from '@prisma/client';

export type { BusinessSector };

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'boolean' | 'date';

export interface FieldOption {
  value: string;
  label: string;
}

/** Show a field only while another field has a given value (e.g. "part brand" only when kind = part). */
export interface FieldCondition {
  field: string;
  equals: string | boolean;
}

export interface FieldDef {
  /** Key inside `Product.attributes`. camelCase, never renamed once data exists. */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  min?: number;
  max?: number;
  /** text defaults to 200 characters, textarea to 1000. */
  maxLength?: number;
  unit?: string;
  placeholder?: string;
  help?: string;
  showWhen?: FieldCondition;
  /** For `select` fields: picking an option also sets the item's `trackStock` default (e.g. "service" = false). */
  trackStockByValue?: Record<string, boolean>;
}

/** A ready-made variant group the owner can add with one tap, then edit. */
export interface VariantPreset {
  name: string;
  required: boolean;
  multiSelect: boolean;
  options: string[];
}

export interface SectorCategory {
  name: string;
  icon: string;
  color: string;
}

/** The words the app uses for "product", so a laundry sees "Layanan" and a café sees "Menu". */
export interface Vocabulary {
  /** Singular noun for headings: "Produk" | "Menu" | "Layanan". */
  item: string;
  /** Same noun in lower case, for sentences. */
  itemLower: string;
  tabLabel: string;
  addItem: string;
  editItem: string;
  addFirstItem: string;
  nameLabel: string;
  namePlaceholder: string;
  skuPlaceholder: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyHint: string;
  infoSection: string;
  photoSection: string;
  priceLabel: string;
  costLabel: string;
  costHint: string;
  unitLabel: string;
  stockSection: string;
  /** Variant editor wording, so a laundry is never told "level pedas, topping". */
  variantSection: string;
  variantHint: string;
  variantGroupPlaceholder: string;
  variantOptionPlaceholder: string;
  /** What the cart is called: "Keranjang" (shop), "Pesanan" (café), "Daftar Layanan" (services). */
  cartNoun: string;
  /** What the business is called in settings: "Toko" for shops, "Usaha" for cafés and service businesses. */
  businessNoun: string;
  /** Example text for the per-line note box. */
  notePlaceholder: string;
}

export interface UnitOption {
  value: string;
  label: string;
  /** Items priced in this unit can be sold in fractions (2.5 kg). Only possible while stock is not tracked. */
  decimal?: boolean;
}

/** A starter item. It pre-fills the product form with everything except the price. */
export interface ItemTemplate {
  name: string;
  /** Name of one of the kind's starter categories. */
  category: string;
  unit: string;
  trackStock: boolean;
  attributes?: Record<string, unknown>;
}

/** One kind of business inside a sector (e.g. service → laundry). */
export interface SubtypeConfig {
  id: string;
  label: string;
  description: string;
  /** lucide icon name used by the app's pickers. */
  icon: string;
  /** Already merged: the sector's base wording plus this kind's overrides. */
  vocabulary: Vocabulary;
  /** Default for `Product.trackStock` when adding an item of this kind. */
  trackStockDefault: boolean;
  units: UnitOption[];
  defaultUnit: string;
  /** Categories created automatically when a store registers with this kind (owner can edit them). */
  categories: SectorCategory[];
  fields: FieldDef[];
  variantPresets: VariantPreset[];
  templates: ItemTemplate[];
}

export interface SectorConfig {
  id: BusinessSector;
  label: string;
  description: string;
  icon: string;
  /** Used when a store has no/unknown kind (the stored value `default` resolves to this). */
  defaultSubtype: string;
  subtypes: SubtypeConfig[];
}
