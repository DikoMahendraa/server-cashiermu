import { expenseLabel } from '../expenses/expense.categories';
import type { EmployeePerformance } from './employee.report';

export const EXPORT_DATASETS = ['transactions', 'expenses', 'employees'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export type Cell = string | number;

/** A plain table the app turns into an .xlsx or .csv file. */
export interface ExportTable {
  dataset: ExportDataset;
  title: string;
  headers: string[];
  rows: Cell[][];
  /** true when more rows matched than the row cap allows. */
  truncated: boolean;
}

export const MAX_EXPORT_ROWS = 5000;

/**
 * Spreadsheet programs run text that starts with = + - @ (or a tab/CR) as a formula. Cashier-typed names and notes
 * end up in these files, so such text is prefixed with an apostrophe (OWASP "CSV injection").
 * Numbers are never touched: a negative amount stays a number.
 */
export function safeCell(value: Cell): Cell {
  return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const wib = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** "2026-10-18 14:30" in WIB. */
export const formatWib = (date: Date): string => wib.format(date);

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  debit_card: 'Kartu debit',
  credit_card: 'Kartu kredit',
};

export interface TransactionExportInput {
  createdAt: Date;
  invoiceNumber: string;
  status: string;
  cashier: string;
  branch: string;
  customerName: string;
  paymentMethods: string[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  grandTotal: number;
}

export interface ExpenseExportInput {
  spentAt: Date;
  category: string;
  amount: number;
  note: string;
  branch: string | null;
  recordedBy: string;
}

const finish = (
  dataset: ExportDataset,
  title: string,
  headers: string[],
  rows: Cell[][],
  total: number,
): ExportTable => ({
  dataset,
  title,
  headers,
  rows: rows.slice(0, MAX_EXPORT_ROWS).map(row => row.map(safeCell)),
  truncated: total > MAX_EXPORT_ROWS,
});

export function transactionsTable(rows: TransactionExportInput[], total = rows.length): ExportTable {
  return finish(
    'transactions',
    'Transaksi',
    [
      'Tanggal',
      'No. Struk',
      'Status',
      'Kasir',
      'Cabang',
      'Pelanggan',
      'Metode Bayar',
      'Subtotal',
      'Diskon',
      'Pajak',
      'Biaya Layanan',
      'Total',
    ],
    rows.map(row => [
      formatWib(row.createdAt),
      row.invoiceNumber,
      row.status === 'voided' ? 'Dibatalkan' : 'Lunas',
      row.cashier,
      row.branch,
      row.customerName,
      row.paymentMethods.map(method => PAYMENT_LABELS[method] ?? method).join(', '),
      row.subtotal,
      row.discountAmount,
      row.taxAmount,
      row.serviceChargeAmount,
      row.grandTotal,
    ]),
    total,
  );
}

export function expensesTable(rows: ExpenseExportInput[], total = rows.length): ExportTable {
  return finish(
    'expenses',
    'Pengeluaran',
    ['Tanggal', 'Kategori', 'Jumlah', 'Catatan', 'Cabang', 'Dicatat Oleh'],
    rows.map(row => [
      formatWib(row.spentAt).slice(0, 10),
      expenseLabel(row.category),
      row.amount,
      row.note,
      row.branch ?? 'Semua cabang',
      row.recordedBy,
    ]),
    total,
  );
}

export function employeesTable(performance: EmployeePerformance): ExportTable {
  return finish(
    'employees',
    'Kinerja Karyawan',
    [
      'Karyawan',
      'Transaksi',
      'Penjualan Bersih',
      'Rata-rata/Transaksi',
      'Diskon',
      'Laba Kotor',
      'Margin (%)',
      'Porsi Penjualan (%)',
      'Dibatalkan (jumlah)',
      'Dibatalkan (nilai)',
    ],
    performance.employees.map(row => [
      row.name,
      row.transactionCount,
      row.netSales,
      row.averageSale,
      row.discounts,
      row.grossProfit,
      row.marginPct ?? '',
      row.salesSharePct,
      row.voidedCount,
      row.voidedAmount,
    ]),
    performance.employees.length,
  );
}
