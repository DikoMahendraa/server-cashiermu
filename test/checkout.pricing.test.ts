import { describe, expect, it } from 'vitest';
import {
  CheckoutError,
  PricingProduct,
  PricingStore,
  priceCart,
  settlePayments,
} from '../src/modules/transactions/checkout.pricing';

const store: PricingStore = {
  taxEnabled: false,
  taxRate: 0,
  serviceChargeEnabled: false,
  serviceChargeRate: 0,
  globalDiscountEnabled: false,
  globalDiscountType: 'percent',
  globalDiscountValue: 0,
};

const coffee: PricingProduct = {
  id: 'p-coffee',
  name: 'Kopi Susu',
  sellPrice: 20000,
  buyPrice: 8000,
  discountEnabled: false,
  discountType: 'percent',
  discountValue: 0,
  variantGroups: [
    {
      id: 'g-size',
      name: 'Ukuran',
      required: true,
      multiSelect: false,
      options: [
        { id: 'o-reg', label: 'Regular', priceModifier: 0 },
        { id: 'o-large', label: 'Large', priceModifier: 5000 },
      ],
    },
    {
      id: 'g-topping',
      name: 'Topping',
      required: false,
      multiSelect: true,
      options: [
        { id: 'o-boba', label: 'Boba', priceModifier: 3000 },
        { id: 'o-jelly', label: 'Jelly', priceModifier: 2000 },
      ],
    },
  ],
};

const bread: PricingProduct = {
  id: 'p-bread',
  name: 'Roti',
  sellPrice: 10000,
  buyPrice: 6000,
  discountEnabled: false,
  discountType: 'percent',
  discountValue: 0,
  variantGroups: [],
};

const products = new Map([
  [coffee.id, coffee],
  [bread.id, bread],
]);

const line = (
  productId: string,
  unitPrice: number,
  quantity = 1,
  optionIds: string[] = [],
  itemDiscount: any = null,
) => ({
  productId,
  unitPrice,
  quantity,
  itemDiscount,
  selectedVariants: optionIds.map(optionId => ({ optionId })),
});

function expectCheckoutError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CheckoutError);
    expect((err as CheckoutError).code).toBe(code);
    return err as CheckoutError;
  }
  throw new Error(`expected CheckoutError ${code}`);
}

describe('priceCart', () => {
  it('prices variants from DB modifiers, not from the client', () => {
    const cart = priceCart([line('p-coffee', 28000, 2, ['o-large', 'o-boba'])], products, store);
    expect(cart.items[0].unitPrice).toBe(28000);
    expect(cart.items[0].subtotal).toBe(56000);
    expect(cart.items[0].selectedVariants.map(v => v.optionLabel)).toEqual(['Large', 'Boba']);
    expect(cart.grandTotal).toBe(56000);
  });

  it('copies the product buy price onto each line as costPrice, regardless of variants or discounts', () => {
    const cart = priceCart(
      [
        line('p-coffee', 28000, 2, ['o-large', 'o-boba']),
        line('p-bread', 10000, 1, [], { type: 'percent', value: 50 }),
      ],
      products,
      store,
    );
    expect(cart.items.map(i => i.costPrice)).toEqual([8000, 6000]);
  });

  it('rejects a tampered or stale unit price with PRICE_CHANGED', () => {
    const err = expectCheckoutError(() => priceCart([line('p-bread', 1)], products, store), 'PRICE_CHANGED');
    expect(err.status).toBe(409);
    expect(err.details).toEqual([
      { index: 0, productId: 'p-bread', productName: 'Roti', clientUnitPrice: 1, unitPrice: 10000 },
    ]);
  });

  it('accepts the same product on several lines with different variants', () => {
    const cart = priceCart(
      [line('p-coffee', 20000, 1, ['o-reg']), line('p-coffee', 25000, 1, ['o-large'])],
      products,
      store,
    );
    expect(cart.subtotal).toBe(45000);
  });

  it('applies product discount then global discount (amount) before variant modifiers', () => {
    const discounted = { ...bread, discountEnabled: true, discountType: 'percent', discountValue: 10 };
    const cart = priceCart([line('p-bread', 8000)], new Map([[bread.id, discounted]]), {
      ...store,
      globalDiscountEnabled: true,
      globalDiscountType: 'amount',
      globalDiscountValue: 1000,
    });
    expect(cart.items[0].unitPrice).toBe(8000); // 10000 * 0.9 - 1000
  });

  it('applies item discounts like the app (percent floors, nominal never below zero)', () => {
    const cart = priceCart(
      [
        line('p-bread', 10000, 3, [], { type: 'percent', value: 33 }),
        line('p-coffee', 20000, 1, ['o-reg'], { type: 'nominal', value: 50000 }),
      ],
      products,
      store,
    );
    // Known float artifact shared with the app: 30000 * (1 - 0.33) = 20099.999… → 20099, not 20100.
    // Kept for client/server parity; fix both sides together (integer math: floor(base * (100 - v) / 100)).
    expect(cart.items[0].subtotal).toBe(20099);
    expect(cart.items[1].subtotal).toBe(0);
  });

  it('caps the cart discount at the subtotal and floors tax and service charge', () => {
    const taxed = { ...store, taxEnabled: true, taxRate: 0.11, serviceChargeEnabled: true, serviceChargeRate: 0.05 };
    const capped = priceCart([line('p-bread', 10000)], products, taxed, { type: 'nominal', value: 999999 });
    expect(capped.discountAmount).toBe(10000);
    expect(capped.grandTotal).toBe(0);

    const cart = priceCart([line('p-bread', 10000, 1)], products, taxed, { type: 'percent', value: 15 });
    expect(cart.discountAmount).toBe(1500);
    expect(cart.taxAmount).toBe(935); // floor(8500 * 0.11)
    expect(cart.serviceChargeAmount).toBe(425); // floor(8500 * 0.05)
    expect(cart.grandTotal).toBe(9860);
  });

  it('validates variant selections', () => {
    expectCheckoutError(() => priceCart([line('p-coffee', 20000, 1, [])], products, store), 'INVALID_VARIANT'); // required missing
    expectCheckoutError(
      () => priceCart([line('p-coffee', 25000, 1, ['o-reg', 'o-large'])], products, store),
      'INVALID_VARIANT',
    ); // single-select twice
    expectCheckoutError(
      () => priceCart([line('p-coffee', 20000, 1, ['o-reg', 'o-reg'])], products, store),
      'INVALID_VARIANT',
    ); // duplicate
    expectCheckoutError(() => priceCart([line('p-bread', 10000, 1, ['o-reg'])], products, store), 'INVALID_VARIANT'); // other product's option
  });

  it('rejects unknown products', () => {
    expectCheckoutError(() => priceCart([line('p-missing', 1000)], products, store), 'PRODUCT_UNAVAILABLE');
  });
});

describe('settlePayments', () => {
  it('records cash net of change and keeps the tendered amount separately', () => {
    const s = settlePayments([{ method: 'cash', amount: 100000 }], 56000);
    expect(s.cashTendered).toBe(100000);
    expect(s.changeAmount).toBe(44000);
    expect(s.entries).toEqual([{ method: 'cash', amount: 56000, reference: null }]);
    expect(s.cashApplied).toBe(56000);
    expect(s.digitalApplied).toBe(0);
  });

  it('handles split cash + QRIS with change coming only from cash', () => {
    const s = settlePayments(
      [
        { method: 'qris', amount: 30000, reference: 'QR-1' },
        { method: 'cash', amount: 50000 },
      ],
      56000,
    );
    expect(s.changeAmount).toBe(24000);
    expect(s.entries).toEqual([
      { method: 'qris', amount: 30000, reference: 'QR-1' },
      { method: 'cash', amount: 26000, reference: null },
    ]);
  });

  it('rejects underpayment and non-cash overpayment', () => {
    expectCheckoutError(() => settlePayments([{ method: 'cash', amount: 50000 }], 56000), 'INSUFFICIENT_PAYMENT');
    expectCheckoutError(() => settlePayments([{ method: 'transfer', amount: 60000 }], 56000), 'NON_CASH_OVERPAYMENT');
  });

  it('drops cash entries fully covered by change but keeps one entry for a zero total', () => {
    const s = settlePayments(
      [
        { method: 'qris', amount: 56000 },
        { method: 'cash', amount: 5000 },
      ],
      56000,
    );
    expect(s.entries).toEqual([{ method: 'qris', amount: 56000, reference: null }]);
    expect(s.changeAmount).toBe(5000);

    const free = settlePayments([{ method: 'cash', amount: 0 }], 0);
    expect(free.entries).toEqual([{ method: 'cash', amount: 0, reference: null }]);
  });
});
