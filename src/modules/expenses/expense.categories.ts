/** Single source of truth for expense categories. The enum in prisma/schema.prisma must list the same keys. */
export const EXPENSE_CATEGORIES = [
  'rent',
  'salary',
  'utilities',
  'transport',
  'promotion',
  'supplies',
  'other',
] as const;
export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategoryKey, string> = {
  rent: 'Sewa',
  salary: 'Gaji',
  utilities: 'Listrik, air & internet',
  transport: 'Transportasi',
  promotion: 'Promosi',
  supplies: 'Perlengkapan',
  other: 'Lainnya',
};

export const expenseLabel = (category: string): string =>
  EXPENSE_CATEGORY_LABELS[category as ExpenseCategoryKey] ?? category;
