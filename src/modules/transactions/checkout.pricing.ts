// Pure pricing & payment rules for checkout — no DB access, fully unit-testable.
// Formulas intentionally mirror the mobile app (useAppStore computeUnitPrice /
// applyItemDiscount / getCartTotal) so the server total equals what the cashier saw.

export class CheckoutError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export type DiscountInput = { type: 'percent' | 'nominal'; value: number; label?: string };

export interface PricingProduct {
  id: string;
  name: string;
  sellPrice: number;
  /** HPP per unit; copied onto each sale line so profit survives later buy-price changes. */
  buyPrice: number;
  /** Quantity may be fractional (2.5 kg). Without this, only whole quantities are accepted. */
  allowDecimalQty: boolean;
  discountEnabled: boolean;
  discountType: string; // 'percent' | 'amount'
  discountValue: number;
  variantGroups: {
    id: string;
    name: string;
    required: boolean;
    multiSelect: boolean;
    options: { id: string; label: string; priceModifier: number }[];
  }[];
}

export interface PricingStore {
  taxEnabled: boolean;
  taxRate: number;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
  globalDiscountEnabled: boolean;
  globalDiscountType: string; // 'percent' | 'amount'
  globalDiscountValue: number;
}

export interface PricingItemInput {
  productId: string;
  quantity: number;
  unitPrice: number; // what the client displayed — only used for mismatch detection
  selectedVariants: { optionId: string }[];
  note?: string;
  itemDiscount?: DiscountInput | null;
}

export interface PricedVariant {
  groupId: string;
  groupName: string;
  optionId: string;
  optionLabel: string;
  priceModifier: number;
}

export interface PricedItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /** Cost (HPP) per unit at the moment of sale. */
  costPrice: number;
  subtotal: number;
  note: string;
  selectedVariants: PricedVariant[];
  itemDiscount: DiscountInput | null;
}

export interface PricedCart {
  items: PricedItem[];
  subtotal: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  serviceChargeRate: number;
  serviceChargeAmount: number;
  grandTotal: number;
}

// Client and server use the same float formulas; this only absorbs representation noise.
const PRICE_TOLERANCE = 0.01;

/**
 * Price of one sale line before discounts. Whole quantities multiply exactly as before; a fractional quantity
 * (2.333 kg × 7.000) is rounded to a whole Rupiah. The mobile app uses the same rule so totals match.
 */
export const lineAmount = (unitPrice: number, quantity: number): number =>
  Number.isInteger(quantity) ? unitPrice * quantity : Math.round(unitPrice * quantity);

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function applyProductDiscount(base: number, type: string, value: number): number {
  if (type === 'percent') return base * (1 - Math.min(value, 100) / 100);
  return Math.max(0, base - value);
}

function applyItemDiscount(base: number, discount: DiscountInput): number {
  if (discount.type === 'percent') return Math.floor(base * (1 - Math.min(discount.value, 100) / 100));
  return Math.max(0, base - discount.value);
}

function resolveVariants(product: PricingProduct, selected: { optionId: string }[]): PricedVariant[] {
  const optionIndex = new Map<string, PricedVariant & { multiSelect: boolean }>();
  for (const group of product.variantGroups) {
    for (const opt of group.options) {
      optionIndex.set(opt.id, {
        groupId: group.id,
        groupName: group.name,
        optionId: opt.id,
        optionLabel: opt.label,
        priceModifier: Number(opt.priceModifier),
        multiSelect: group.multiSelect,
      });
    }
  }

  const seen = new Set<string>();
  const perGroup = new Map<string, number>();
  const resolved: PricedVariant[] = [];

  for (const { optionId } of selected) {
    const opt = optionIndex.get(optionId);
    if (!opt || seen.has(optionId)) {
      throw new CheckoutError(422, 'INVALID_VARIANT', `Varian tidak valid untuk produk: ${product.name}`);
    }
    seen.add(optionId);
    const count = (perGroup.get(opt.groupId) ?? 0) + 1;
    if (count > 1 && !opt.multiSelect) {
      throw new CheckoutError(
        422,
        'INVALID_VARIANT',
        `Hanya boleh pilih satu ${opt.groupName} untuk produk: ${product.name}`,
      );
    }
    perGroup.set(opt.groupId, count);
    const { multiSelect: _m, ...variant } = opt;
    resolved.push(variant);
  }

  for (const group of product.variantGroups) {
    if (group.required && !perGroup.has(group.id)) {
      throw new CheckoutError(422, 'INVALID_VARIANT', `${group.name} wajib dipilih untuk produk: ${product.name}`);
    }
  }

  return resolved;
}

export function computeUnitPrice(product: PricingProduct, variants: PricedVariant[], store: PricingStore): number {
  let base = Number(product.sellPrice);
  if (product.discountEnabled && Number(product.discountValue) > 0) {
    base = applyProductDiscount(base, product.discountType, Number(product.discountValue));
  }
  if (store.globalDiscountEnabled && Number(store.globalDiscountValue) > 0) {
    base = applyProductDiscount(base, store.globalDiscountType, Number(store.globalDiscountValue));
  }
  return base + variants.reduce((sum, v) => sum + v.priceModifier, 0);
}

/**
 * Recomputes every price from DB data. Client-sent prices are never trusted:
 * if they differ from the server's, PRICE_CHANGED is thrown so the cashier can
 * refresh instead of charging a total the customer never agreed to.
 */
export function priceCart(
  items: PricingItemInput[],
  products: Map<string, PricingProduct>,
  store: PricingStore,
  cartDiscount?: DiscountInput | null,
): PricedCart {
  const priced: PricedItem[] = [];
  const mismatches: {
    index: number;
    productId: string;
    productName: string;
    clientUnitPrice: number;
    unitPrice: number;
  }[] = [];

  for (const [index, item] of items.entries()) {
    const product = products.get(item.productId);
    if (!product) {
      throw new CheckoutError(422, 'PRODUCT_UNAVAILABLE', 'Satu atau lebih produk tidak ditemukan atau tidak aktif');
    }

    if (!Number.isInteger(item.quantity) && !product.allowDecimalQty) {
      throw new CheckoutError(422, 'INVALID_QUANTITY', `Jumlah harus bilangan bulat untuk: ${product.name}`);
    }

    const variants = resolveVariants(product, item.selectedVariants);
    const unitPrice = computeUnitPrice(product, variants, store);
    if (Math.abs(unitPrice - item.unitPrice) > PRICE_TOLERANCE) {
      mismatches.push({
        index,
        productId: product.id,
        productName: product.name,
        clientUnitPrice: item.unitPrice,
        unitPrice: round2(unitPrice),
      });
    }

    const lineBase = lineAmount(unitPrice, item.quantity);
    const itemDiscount = item.itemDiscount ?? null;
    const subtotal = itemDiscount ? applyItemDiscount(lineBase, itemDiscount) : lineBase;

    priced.push({
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPrice: round2(unitPrice),
      costPrice: round2(product.buyPrice),
      subtotal: round2(subtotal),
      note: item.note ?? '',
      selectedVariants: variants,
      itemDiscount,
    });
  }

  if (mismatches.length > 0) {
    throw new CheckoutError(
      409,
      'PRICE_CHANGED',
      'Harga produk telah berubah. Muat ulang produk lalu coba lagi.',
      mismatches,
    );
  }

  const subtotal = round2(priced.reduce((sum, i) => sum + i.subtotal, 0));

  let discountAmount = 0;
  if (cartDiscount) {
    discountAmount =
      cartDiscount.type === 'percent'
        ? Math.floor((subtotal * Math.min(cartDiscount.value, 100)) / 100)
        : Math.min(cartDiscount.value, subtotal);
  }

  const taxableBase = subtotal - discountAmount;
  const taxRate = store.taxEnabled ? Number(store.taxRate) : 0;
  const serviceChargeRate = store.serviceChargeEnabled ? Number(store.serviceChargeRate) : 0;
  const taxAmount = Math.floor(taxableBase * taxRate);
  const serviceChargeAmount = Math.floor(taxableBase * serviceChargeRate);

  return {
    items: priced,
    subtotal,
    discountAmount: round2(discountAmount),
    taxRate,
    taxAmount,
    serviceChargeRate,
    serviceChargeAmount,
    grandTotal: round2(taxableBase + taxAmount + serviceChargeAmount),
  };
}

export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'debit_card' | 'credit_card';

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
}

export interface SettledPayments {
  /** Amounts actually applied to the bill (cash net of change) — what gets recorded. */
  entries: { method: PaymentMethod; amount: number; reference: string | null }[];
  cashTendered: number;
  changeAmount: number;
  cashApplied: number;
  digitalApplied: number;
}

/**
 * Validates tendered payments against the grand total. Change can only come
 * from cash, and recorded payment entries hold the applied amount so shift
 * cash totals and payment-method reports are not inflated by change given back.
 */
export function settlePayments(payments: PaymentInput[], grandTotal: number): SettledPayments {
  const cashTendered = round2(payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0));
  const nonCash = round2(payments.filter(p => p.method !== 'cash').reduce((s, p) => s + p.amount, 0));
  const totalTendered = round2(cashTendered + nonCash);

  if (nonCash - grandTotal > PRICE_TOLERANCE) {
    throw new CheckoutError(422, 'NON_CASH_OVERPAYMENT', 'Pembayaran non-tunai melebihi total tagihan');
  }
  if (grandTotal - totalTendered > PRICE_TOLERANCE) {
    throw new CheckoutError(422, 'INSUFFICIENT_PAYMENT', 'Jumlah pembayaran kurang dari total tagihan', {
      grandTotal,
      paid: totalTendered,
    });
  }

  const changeAmount = Math.max(0, round2(totalTendered - grandTotal));

  // Deduct change from cash entries (last first) so recorded amounts sum to the grand total.
  let remainingChange = changeAmount;
  const entries = payments
    .map(p => ({ method: p.method, amount: p.amount, reference: p.reference ?? null }))
    .reverse()
    .map(p => {
      if (p.method !== 'cash' || remainingChange <= 0) return p;
      const deducted = Math.min(p.amount, remainingChange);
      remainingChange = round2(remainingChange - deducted);
      return { ...p, amount: round2(p.amount - deducted) };
    })
    .reverse();

  const nonZero = entries.filter(e => e.amount > 0);
  const recorded = nonZero.length > 0 ? nonZero : entries.slice(0, 1);

  return {
    entries: recorded,
    cashTendered,
    changeAmount,
    cashApplied: round2(recorded.filter(e => e.method === 'cash').reduce((s, e) => s + e.amount, 0)),
    digitalApplied: round2(recorded.filter(e => e.method !== 'cash').reduce((s, e) => s + e.amount, 0)),
  };
}
