import { describe, expect, it } from 'vitest';
import { buildProfitReport } from '../src/modules/reports/profit.report';

const sales = {
  transactionCount: 3,
  grossSales: 200000,
  discounts: 10000,
  taxCollected: 19000,
  serviceChargeCollected: 0,
};

describe('buildProfitReport', () => {
  it('computes net sales, COGS, gross profit and margin without counting tax as revenue', () => {
    const report = buildProfitReport(
      sales,
      [{ userId: 'u1', name: 'Siti', transactionCount: 3, grossSales: 200000, discounts: 10000 }],
      [{ userId: 'u1', cogs: 95000 }],
      [],
    );
    expect(report).toMatchObject({
      grossSales: 200000,
      discounts: 10000,
      netSales: 190000,
      cogs: 95000,
      grossProfit: 95000,
      marginPct: 50,
      taxCollected: 19000, // reported separately, not part of netSales
    });
  });

  it('splits by employee, sorted by net sales, with a zero-cost employee handled', () => {
    const report = buildProfitReport(
      { ...sales, grossSales: 300000, discounts: 0 },
      [
        { userId: 'u1', name: 'Siti', transactionCount: 1, grossSales: 100000, discounts: 0 },
        { userId: 'u2', name: 'Budi', transactionCount: 2, grossSales: 200000, discounts: 0 },
      ],
      [{ userId: 'u2', cogs: 120000 }], // u1 has no cost rows
      [],
    );
    expect(report.byEmployee.map(e => [e.name, e.netSales, e.cogs, e.grossProfit, e.marginPct])).toEqual([
      ['Budi', 200000, 120000, 80000, 40],
      ['Siti', 100000, 0, 100000, 100],
    ]);
    expect(report.cogs).toBe(120000);
    expect(report.grossProfit).toBe(180000);
  });

  it('returns a null margin (not NaN or Infinity) when there are no sales', () => {
    const report = buildProfitReport(
      { transactionCount: 0, grossSales: 0, discounts: 0, taxCollected: 0, serviceChargeCollected: 0 },
      [],
      [],
      [],
    );
    expect(report).toMatchObject({
      netSales: 0,
      cogs: 0,
      grossProfit: 0,
      marginPct: null,
      byEmployee: [],
      topProducts: [],
    });
  });

  it('can report a loss and negative margin', () => {
    const report = buildProfitReport(
      { ...sales, grossSales: 100000, discounts: 0 },
      [],
      [{ userId: 'u1', cogs: 120000 }],
      [{ productId: 'p1', productName: 'Kopi', quantity: 10, revenue: 100000, cogs: 120000 }],
    );
    expect(report.grossProfit).toBe(-20000);
    expect(report.marginPct).toBe(-20);
    expect(report.topProducts[0]).toMatchObject({ profit: -20000 });
  });

  it('rounds each figure first, so the numbers shown always add up (100.01 − 33.33 = 66.68)', () => {
    const report = buildProfitReport(
      { ...sales, grossSales: 100.005, discounts: 0, taxCollected: 0 },
      [],
      [{ userId: 'u1', cogs: 33.333 }],
      [],
    );
    expect(report.netSales).toBe(100.01);
    expect(report.cogs).toBe(33.33);
    expect(report.grossProfit).toBe(66.68);
  });
});
