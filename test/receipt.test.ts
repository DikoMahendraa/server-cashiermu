import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatQuantity,
  formatRupiah,
  renderReceiptNotFound,
  renderReceiptPage,
  type ReceiptView,
} from '../src/modules/receipts/receipt.html';
import { RECEIPT_TOKEN_PATTERN, newReceiptToken, receiptUrl } from '../src/modules/transactions/job';
import { createTransactionSchema, updateJobSchema } from '../src/modules/transactions/transactions.schema';

const view = (overrides: Partial<ReceiptView> = {}): ReceiptView => ({
  store: { name: 'Laundry <Bersih>', address: 'Jl. Mawar 1', phone: '0811', header: '', footer: 'Terima kasih' },
  invoiceNumber: 'INV-20261018-0001',
  createdAt: new Date('2026-10-18T03:00:00Z'),
  voided: false,
  customerName: 'Budi',
  job: { status: 'in_progress', updatedAt: new Date('2026-10-18T04:00:00Z'), dueAt: new Date('2026-10-19T03:00:00Z') },
  items: [{ name: 'Cuci Kiloan', quantity: 2.5, unitPrice: 7000, subtotal: 17500, variants: ['Express'], note: '' }],
  subtotal: 17500,
  discountAmount: 0,
  taxAmount: 0,
  serviceChargeAmount: 0,
  grandTotal: 17500,
  payments: [{ method: 'qris', amount: 17500 }],
  note: '',
  ...overrides,
});

describe('formatting', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('formats rupiah and quantities the Indonesian way', () => {
    expect(formatRupiah(1234567)).toBe('Rp 1.234.567');
    expect(formatRupiah(0)).toBe('Rp 0');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(1.5)).toBe('1,5');
    expect(formatQuantity(0.25)).toBe('0,25');
  });
});

describe('renderReceiptPage', () => {
  it('shows store, items, total and the job progress in WIB', () => {
    const html = renderReceiptPage(view());
    expect(html).toContain('Laundry &lt;Bersih&gt;');
    expect(html).toContain('Cuci Kiloan');
    expect(html).toContain('2,5 × Rp 7.000');
    expect(html).toContain('Express');
    expect(html).toContain('Rp 17.500');
    expect(html).toContain('QRIS');
    expect(html).toContain('Diproses');
    expect(html).toContain('10:00 WIB'); // 03:00 UTC
    expect(html).toContain('class="done">Menunggu');
    expect(html).not.toContain('class="done">Siap diambil');
  });

  it('escapes customer-controlled text', () => {
    const html = renderReceiptPage(view({ customerName: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('omits the status card for non-jobs and shows "Dibatalkan" for voided sales', () => {
    expect(renderReceiptPage(view({ job: null }))).not.toContain('Status pesanan');
    expect(renderReceiptPage(view({ voided: true }))).toContain('Dibatalkan');
  });

  it('has a not-found page', () => {
    expect(renderReceiptNotFound()).toContain('Struk tidak ditemukan');
  });
});

describe('receipt tokens and links', () => {
  it('are unguessable, url-safe and unique', () => {
    const tokens = new Set(Array.from({ length: 50 }, newReceiptToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(RECEIPT_TOKEN_PATTERN);
  });
  it('builds the link without a double slash', () => {
    expect(receiptUrl('https://api.example.com/', 'abc')).toBe('https://api.example.com/r/abc');
  });
});

describe('job schemas', () => {
  const base = {
    items: [{ productId: '2f0e8a4e-1c7d-4a0b-9c1a-3b6f1d2e4a5b', quantity: 1, unitPrice: 1000 }],
    payments: [{ method: 'cash', amount: 1000 }],
  };
  it('accepts common Indonesian phone formats and blank', () => {
    for (const customerPhone of ['', '081234567890', '0812-3456-7890', '+62 812 3456 7890', '(021) 555-1234']) {
      expect(createTransactionSchema.safeParse({ ...base, customerPhone }).success, customerPhone).toBe(true);
    }
  });
  it('rejects letters and wrong lengths', () => {
    for (const customerPhone of ['abc', '12345', '1'.repeat(16), '0812 xx 123456']) {
      expect(createTransactionSchema.safeParse({ ...base, customerPhone }).success, customerPhone).toBe(false);
    }
  });
  it('requires at least one change when updating a job', () => {
    expect(updateJobSchema.safeParse({}).success).toBe(false);
    expect(updateJobSchema.safeParse({ jobStatus: 'ready' }).success).toBe(true);
    expect(updateJobSchema.safeParse({ dueAt: null }).success).toBe(true);
    expect(updateJobSchema.safeParse({ jobStatus: 'done' }).success).toBe(false);
  });
});
