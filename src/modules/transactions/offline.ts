import { CheckoutError, type PriceAdjustment } from './checkout.pricing';

/** Sales older than this are refused: something is wrong with the device clock or the queue. */
export const OFFLINE_MAX_AGE_DAYS = 30;
/** Phone clocks drift a little; a sale "from the future" by more than this is refused. */
export const OFFLINE_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** A price edit this close before the sale still counts as "after" (clock drift between phone and server). */
const PRICE_EDIT_SKEW_MS = 60 * 1000;

export type OfflineIssue =
  | { type: 'PRICE_ADJUSTED'; productId: string; productName: string; clientUnitPrice: number; serverUnitPrice: number }
  | { type: 'STOCK_NEGATIVE'; productId: string; productName: string; stock: number }
  | { type: 'SHIFT_CLOSED'; shiftId: string };

export function assertOfflineSaleTime(createdAt: Date, now: Date = new Date()): void {
  if (createdAt.getTime() > now.getTime() + OFFLINE_CLOCK_SKEW_MS) {
    throw new CheckoutError(422, 'OFFLINE_SALE_IN_FUTURE', 'Waktu transaksi offline tidak valid (di masa depan)');
  }
  if (createdAt.getTime() < now.getTime() - OFFLINE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new CheckoutError(
      422,
      'OFFLINE_SALE_TOO_OLD',
      `Transaksi offline lebih dari ${OFFLINE_MAX_AGE_DAYS} hari tidak dapat disinkronkan`,
    );
  }
}

/**
 * An offline sale may keep its old price only if the price could really have changed after the sale was made: the
 * product (or the store's discount settings) was edited since. Otherwise a price that differs from today's is
 * simply wrong, and the sale is refused like any online sale (PRICE_CHANGED).
 */
export function changedAfterSale(editedAt: (Date | null | undefined)[], saleTime: Date): boolean {
  const latest = Math.max(...editedAt.map(date => date?.getTime() ?? 0));
  return latest > saleTime.getTime() - PRICE_EDIT_SKEW_MS;
}

export const priceIssues = (adjustments: PriceAdjustment[]): OfflineIssue[] =>
  adjustments.map(a => ({ type: 'PRICE_ADJUSTED' as const, ...a }));
