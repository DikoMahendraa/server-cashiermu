# Offline sales

When the phone cannot reach the server, the app keeps selling. Each sale is saved on the phone and sent automatically when the
server is reachable again (no button). This page is the server's side of that contract.

## How the app behaves (so the server rules make sense)

- A connection monitor asks `GET /health` every 30 s (every 6 s while offline) and also learns from every API call.
- **Offline, or no answer / a 5xx during checkout:** the sale is stored in a persisted queue with a **temporary receipt number**
  (`OFF-YYYYMMDD-XXXX`), the time it happened, and **one idempotency key for its whole life**.
- A sync engine sends queued sales oldest first. A delivered sale replaces the local copy; a refused sale is marked *failed*
  and shown to the user; a connection problem just waits for the next try.
- The session and catalog are saved too, so the app can start and sell with no connection.

## The `offline` block

`POST /transactions` accepts, next to the normal body, `offline: { createdAt, receiptNumber }`. Everything else about the
request is unchanged (same idempotency key header, same payload the app would have sent online).

| Rule | What the server does |
| ---- | -------------------- |
| Time | `createdAt` must not be more than 5 min in the future (`422 OFFLINE_SALE_IN_FUTURE`) nor older than 30 days (`422 OFFLINE_SALE_TOO_OLD`). The sale is stored with that time, so reports use the day it really happened. |
| Price | A price that differs from today's is normally `409 PRICE_CHANGED`. For an offline sale it is **kept at the price the customer saw** *only if* the product (or the store's discount settings) was edited after the sale was made (`changedAfterSale`). Otherwise it is still refused, so the `offline` block cannot be used to sell below price. The difference is recorded as `PRICE_ADJUSTED`. |
| Stock | The customer already took the goods, so the sale is accepted even when stock is insufficient; stock may go negative and `STOCK_NEGATIVE` is recorded. (Online it is `422 INSUFFICIENT_STOCK`.) |
| Shift | If the shift was closed before the sale arrived, the sale is still filed under it and its totals still grow (`SHIFT_CLOSED` is recorded). Another cashier's shift is still `403 SHIFT_NOT_OWNED`. |
| Invoice number | The server assigns the real `INV-…` number. The temporary one is kept in `offlineReceiptNumber`. |
| Retries | Same idempotency key → the original sale is returned (`200`, header `Idempotent-Replayed`), stock is decremented once. |

Recorded on the transaction: `syncedAt` (when it arrived), `offlineReceiptNumber`, `offlineIssues` (list of the issues above,
`null` when there are none). The app shows the issues to the owner on the transaction's detail screen.

## Not supported offline (on purpose)

Voiding, editing products, opening/closing shifts, importing, reports and logging in all need the server. The app explains
this instead of queueing them: offline writes other than sales would need conflict rules (see the roadmap).

## Tests

`test/checkout.service.test.ts` ("offline sales"), and `test/e2e/offline-sales.e2e.test.ts` against the live API. The app side
was exercised end to end with the real store and sync engine against a running server (queue → reconnect → single delivery,
failed sale handling, network failure mid-checkout).
