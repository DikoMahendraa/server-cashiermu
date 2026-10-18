# Service jobs & public receipt

For **Jasa & Layanan** stores (`Store.sector = service`) every sale is also a **job**: it has a customer, a due time and a
progress status. Other business types are untouched (`jobStatus` stays `null`). Payment and job status are independent:
a job can be paid and still be in progress.

## Fields on `Transaction`

| Field           | Meaning                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `customerName`  | Already existed; now typed in the payment screen                                 |
| `customerPhone` | 8–15 digits (digits, `+`, `-`, spaces, parentheses); used for WhatsApp           |
| `dueAt`         | Estimated completion, optional                                                   |
| `jobStatus`     | `pending → in_progress → ready → completed`, `null` for non-service sales        |
| `jobUpdatedAt`  | When the status last changed                                                     |
| `receiptToken`  | 192-bit random token of the public receipt page (created at checkout)            |

## Endpoints

| Method | Path                                | Who             | What                                                                 |
| ------ | ----------------------------------- | --------------- | -------------------------------------------------------------------- |
| POST   | `/transactions`                     | owner, cashier  | Accepts `customerPhone`, `dueAt`; service stores get `jobStatus=pending` |
| GET    | `/transactions?jobStatus=open`      | owner, cashier  | Unfinished jobs (or one status). Cashiers see the whole store here so the next shift can continue a job |
| PATCH  | `/transactions/:id/job`             | owner, cashier  | Change `jobStatus`, `dueAt`, `customerName`, `customerPhone`         |
| POST   | `/transactions/:id/receipt-link`    | owner, cashier  | `{ token, url }`; `url` is `null` when `PUBLIC_BASE_URL` is not set  |
| GET    | `/r/:token`                         | **public**      | HTML receipt page with live job status                               |

Errors: `422 NOT_A_JOB` (sale is not a service job), `409 TRANSACTION_VOIDED`, `404` for another store's sale.
Any stage can be set to any other (staff make mistakes); only `jobUpdatedAt` records the change.

## The public receipt page

`src/modules/receipts/`. There is no login: **the unguessable token is the access control**, so:

- 24 random bytes, base64url; looked up by exact match; malformed tokens are rejected before touching the database.
- Rate limited per IP (60/min), `Cache-Control: no-store`, `noindex`, `Referrer-Policy: no-referrer`, and a CSP that forbids scripts.
- It shows only what a customer needs: store name/address/phone, invoice number, date, customer name, items, totals,
  payment method labels and the job status. **Never** staff names, internal ids, cost prices or shift data.
- All text is HTML-escaped (`escapeHtml`); the page is rendered by plain template strings, no framework.
- A voided sale shows "Dibatalkan".

Set `PUBLIC_BASE_URL` (for example `https://api.example.com`) in production. Without it the app shares receipts without a link
instead of handing customers a `localhost` address. Deploy the API behind HTTPS.

## App behaviour (for reference)

Payment screen asks for name, phone and an ETA preset (today/tomorrow/…, 17:00 local); a **Pesanan** tab (service stores only)
lists jobs and moves them forward; "Kabari" opens WhatsApp click-to-chat (`wa.me`) with a message for the current status
and the receipt link. No WhatsApp API or cost is involved; the staff taps send.

## Tests

`test/receipt.test.ts` (renderer, tokens, schemas), `test/checkout.service.test.ts` (job status only for service stores) and
`test/e2e/service-jobs.e2e.test.ts` (full flow against the live API, including escaping and voided sales).
