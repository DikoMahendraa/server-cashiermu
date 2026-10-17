import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../src/utils/invoice', () => ({
  generateInvoiceNumber: vi.fn(async () => 'INV-20261018-0001'),
}));
vi.mock('../src/config/database', () => ({ default: {} }));

import { createCheckout, CheckoutContext } from '../src/modules/transactions/checkout.service';
import { CheckoutError } from '../src/modules/transactions/checkout.pricing';
import { generateInvoiceNumber } from '../src/utils/invoice';
import { CreateTransactionDto } from '../src/modules/transactions/transactions.schema';

// ── In-memory fake of the Prisma calls the checkout uses ─────────────────────

type State = ReturnType<typeof seed>;

function seed() {
  return {
    store: {
      id: 'store-1',
      shiftEnabled: true,
      cashierCanDiscount: false,
      taxEnabled: false,
      taxRate: 0,
      serviceChargeEnabled: false,
      serviceChargeRate: 0,
      globalDiscountEnabled: false,
      globalDiscountType: 'percent',
      globalDiscountValue: 0,
    },
    products: [
      {
        id: 'p-1',
        storeId: 'store-1',
        name: 'Kopi',
        sku: 'KOPI',
        stock: 5,
        isActive: true,
        sellPrice: 20000,
        discountEnabled: false,
        discountType: 'percent',
        discountValue: 0,
        variantGroups: [
          {
            id: 'g-1',
            name: 'Ukuran',
            required: false,
            multiSelect: false,
            options: [
              { id: 'o-reg', label: 'Regular', priceModifier: 0 },
              { id: 'o-large', label: 'Large', priceModifier: 5000 },
            ],
          },
        ],
      },
      {
        id: 'p-other-store',
        storeId: 'store-2',
        name: 'Asing',
        sku: 'X',
        stock: 99,
        isActive: true,
        sellPrice: 1000,
        discountEnabled: false,
        discountType: 'percent',
        discountValue: 0,
        variantGroups: [],
      },
    ],
    shifts: [
      {
        id: 'shift-1',
        storeId: 'store-1',
        userId: 'cashier-1',
        branchId: 'branch-1',
        status: 'open',
        cashSalesTotal: 0,
        digitalSalesTotal: 0,
        transactionCount: 0,
      },
      {
        id: 'shift-other-user',
        storeId: 'store-1',
        userId: 'cashier-2',
        branchId: 'branch-1',
        status: 'open',
        cashSalesTotal: 0,
        digitalSalesTotal: 0,
        transactionCount: 0,
      },
      {
        id: 'shift-other-store',
        storeId: 'store-2',
        userId: 'cashier-1',
        branchId: 'branch-9',
        status: 'open',
        cashSalesTotal: 0,
        digitalSalesTotal: 0,
        transactionCount: 0,
      },
    ],
    branches: [
      { id: 'branch-1', storeId: 'store-1', isActive: true },
      { id: 'branch-2', storeId: 'store-1', isActive: true },
      { id: 'branch-9', storeId: 'store-2', isActive: true },
    ],
    transactions: [] as any[],
  };
}

function makeDb(state: State) {
  const db: any = {
    store: { findUnique: vi.fn(async ({ where }: any) => (where.id === state.store.id ? state.store : null)) },
    shift: {
      findFirst: vi.fn(
        async ({ where }: any) => state.shifts.find(s => s.id === where.id && s.storeId === where.storeId) ?? null,
      ),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const s = state.shifts.find(
          x =>
            x.id === where.id && x.storeId === where.storeId && x.userId === where.userId && x.status === where.status,
        );
        if (!s) return { count: 0 };
        s.cashSalesTotal += data.cashSalesTotal.increment;
        s.digitalSalesTotal += data.digitalSalesTotal.increment;
        s.transactionCount += 1;
        return { count: 1 };
      }),
    },
    branch: {
      findFirst: vi.fn(
        async ({ where }: any) =>
          state.branches.find(b => b.id === where.id && b.storeId === where.storeId && b.isActive) ?? null,
      ),
    },
    product: {
      findMany: vi.fn(async ({ where }: any) =>
        state.products.filter(p => where.id.in.includes(p.id) && p.storeId === where.storeId && p.isActive),
      ),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const p = state.products.find(
          x => x.id === where.id && x.storeId === where.storeId && x.isActive && x.stock >= where.stock.gte,
        );
        if (!p) return { count: 0 };
        p.stock -= data.stock.decrement;
        return { count: 1 };
      }),
    },
    transaction: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.storeId_idempotencyKey;
        return state.transactions.find(t => t.storeId === k.storeId && t.idempotencyKey === k.idempotencyKey) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const tx = {
          id: `tx-${state.transactions.length + 1}`,
          ...data,
          items: data.items.create,
          payments: data.payments.create,
        };
        state.transactions.push(tx);
        return tx;
      }),
    },
  };
  // Simplified: runs the callback on the same fake; rollback is asserted via call counts instead.
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return db;
}

const cashier: CheckoutContext = { userId: 'cashier-1', storeId: 'store-1', role: 'cashier', branchId: 'branch-1' };

const body = (overrides: Partial<CreateTransactionDto> = {}): CreateTransactionDto => ({
  shiftId: 'shift-1',
  customerName: '',
  note: '',
  cashPaid: 0,
  items: [
    { productId: 'p-1', quantity: 1, unitPrice: 20000, selectedVariants: [{ optionId: 'o-reg' } as any], note: '' },
  ],
  payments: [{ method: 'cash', amount: 50000 }],
  ...overrides,
});

async function expectCheckoutError(p: Promise<unknown>, code: string, status?: number) {
  const err = await p.then(
    () => null,
    e => e,
  );
  expect(err).toBeInstanceOf(CheckoutError);
  expect(err.code).toBe(code);
  if (status) expect(err.status).toBe(status);
}

let state: State;
let db: any;

beforeEach(() => {
  state = seed();
  db = makeDb(state);
  vi.mocked(generateInvoiceNumber).mockClear();
});

describe('createCheckout', () => {
  it('creates a sale with server prices, cash net of change, and shift totals', async () => {
    const { transaction, replayed } = await createCheckout(db, cashier, body());
    expect(replayed).toBe(false);
    expect(transaction).toMatchObject({
      grandTotal: 20000,
      cashPaid: 50000,
      changeAmount: 30000,
      branchId: 'branch-1',
    });
    expect((transaction as any).payments).toEqual([{ method: 'cash', amount: 20000, reference: null }]);
    expect(state.shifts[0]).toMatchObject({ cashSalesTotal: 20000, digitalSalesTotal: 0, transactionCount: 1 });
    expect(state.products[0].stock).toBe(4);
  });

  it('accepts the same product on two lines and decrements stock by the combined quantity', async () => {
    await createCheckout(
      db,
      cashier,
      body({
        items: [
          {
            productId: 'p-1',
            quantity: 2,
            unitPrice: 20000,
            selectedVariants: [{ optionId: 'o-reg' } as any],
            note: '',
          },
          {
            productId: 'p-1',
            quantity: 3,
            unitPrice: 25000,
            selectedVariants: [{ optionId: 'o-large' } as any],
            note: '',
          },
        ],
        payments: [{ method: 'qris', amount: 115000 }],
      }),
    );
    expect(state.products[0].stock).toBe(0);
    expect(db.product.updateMany).toHaveBeenCalledTimes(1);
  });

  it('fails atomically when stock is taken by a concurrent sale', async () => {
    db.product.findMany.mockImplementationOnce(async () => [{ ...state.products[0], stock: 5 }]); // stale read
    state.products[0].stock = 0; // sold meanwhile
    await expectCheckoutError(createCheckout(db, cashier, body()), 'INSUFFICIENT_STOCK', 422);
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it('rejects a client price that differs from the server price', async () => {
    await expectCheckoutError(
      createCheckout(
        db,
        cashier,
        body({ items: [{ productId: 'p-1', quantity: 1, unitPrice: 1, selectedVariants: [], note: '' }] }),
      ),
      'PRICE_CHANGED',
      409,
    );
  });

  it('rejects products from another store', async () => {
    await expectCheckoutError(
      createCheckout(
        db,
        cashier,
        body({ items: [{ productId: 'p-other-store', quantity: 1, unitPrice: 1000, selectedVariants: [], note: '' }] }),
      ),
      'PRODUCT_UNAVAILABLE',
      422,
    );
  });

  describe('shift and branch ownership', () => {
    it('rejects a shift from another store', async () => {
      await expectCheckoutError(
        createCheckout(db, cashier, body({ shiftId: 'shift-other-store' })),
        'SHIFT_NOT_OPEN',
        422,
      );
    });

    it("rejects another cashier's shift", async () => {
      await expectCheckoutError(
        createCheckout(db, cashier, body({ shiftId: 'shift-other-user' })),
        'SHIFT_NOT_OWNED',
        403,
      );
    });

    it('requires a shift when the store enables shifts', async () => {
      await expectCheckoutError(createCheckout(db, cashier, body({ shiftId: null })), 'SHIFT_REQUIRED', 422);
    });

    it('fails if the shift is closed between validation and commit', async () => {
      state.shifts[0].status = 'open';
      db.shift.updateMany.mockResolvedValueOnce({ count: 0 });
      await expectCheckoutError(createCheckout(db, cashier, body()), 'SHIFT_NOT_OPEN', 422);
      expect(db.transaction.create).not.toHaveBeenCalled();
    });

    it('validates branchId belongs to the store when shifts are disabled', async () => {
      state.store.shiftEnabled = false;
      const owner = { ...cashier, role: 'owner', userId: 'owner-1' };
      await expectCheckoutError(
        createCheckout(db, owner, body({ shiftId: null, branchId: 'branch-9' })),
        'BRANCH_NOT_FOUND',
        422,
      );

      const { transaction } = await createCheckout(db, owner, body({ shiftId: null, branchId: 'branch-2' }));
      expect(transaction).toMatchObject({ branchId: 'branch-2', shiftId: null });
    });

    it('stops a cashier from booking sales to another branch', async () => {
      state.store.shiftEnabled = false;
      await expectCheckoutError(
        createCheckout(db, cashier, body({ shiftId: null, branchId: 'branch-2' })),
        'BRANCH_NOT_ALLOWED',
        403,
      );
    });
  });

  it('enforces cashierCanDiscount', async () => {
    const discounted = body({
      discount: { type: 'percent', value: 10, label: 'Promo' },
      payments: [{ method: 'cash', amount: 18000 }],
    });
    await expectCheckoutError(createCheckout(db, cashier, discounted), 'DISCOUNT_NOT_ALLOWED', 403);

    state.store.cashierCanDiscount = true;
    const { transaction } = await createCheckout(db, cashier, discounted);
    expect(transaction).toMatchObject({ discountAmount: 2000, grandTotal: 18000 });
  });

  describe('idempotency', () => {
    it('returns the original transaction on retry without charging again', async () => {
      const first = await createCheckout(db, cashier, body(), 'key-12345678');
      const second = await createCheckout(db, cashier, body(), 'key-12345678');
      expect(second.replayed).toBe(true);
      expect(second.transaction.id).toBe(first.transaction.id);
      expect(state.transactions).toHaveLength(1);
      expect(state.products[0].stock).toBe(4);
      expect(state.shifts[0].transactionCount).toBe(1);
    });

    it('returns the winner when a concurrent request with the same key commits first', async () => {
      const winner = { id: 'tx-winner', storeId: 'store-1', userId: 'cashier-1', idempotencyKey: 'key-12345678' };
      db.transaction.create.mockImplementationOnce(async () => {
        state.transactions.push(winner);
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['storeId', 'idempotencyKey'] },
        });
      });
      const result = await createCheckout(db, cashier, body(), 'key-12345678');
      expect(result).toEqual({ transaction: winner, replayed: true });
    });

    it("refuses to replay another user's transaction", async () => {
      state.transactions.push({ id: 'tx-x', storeId: 'store-1', userId: 'cashier-2', idempotencyKey: 'key-12345678' });
      await expectCheckoutError(createCheckout(db, cashier, body(), 'key-12345678'), 'IDEMPOTENCY_KEY_REUSED', 409);
    });
  });

  it('retries with a new invoice number on invoice collision', async () => {
    db.transaction.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['invoiceNumber'] },
      }),
    );
    const { transaction } = await createCheckout(db, cashier, body());
    expect(transaction).toBeDefined();
    expect(generateInvoiceNumber).toHaveBeenCalledTimes(2);
  });
});
