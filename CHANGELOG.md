# Changelog — CashierMu API (Backend)

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

## [1.9.0] — 2026-10-19

### Added

- **Delete account.** `POST /store/delete-account` (owner only, body `{ pin }`) permanently deletes the store and everything in it (staff, products, transactions, shifts, expenses) in one database transaction. The PIN is checked first, and the route is limited to 5 attempts per 15 minutes per owner. Required by Google Play for apps with accounts. Covered by `test/e2e/delete-account.e2e.test.ts`.
  - Migration: none.
  - App compatibility: works with all app versions; app ≥ 1.9.0 has the Delete Account screen.
- **Deploy to a VPS with Docker.** `Dockerfile` (two stages, runs as a non-root user, healthcheck) and the `deploy/` folder: `docker-compose.prod.yml` (PostgreSQL + API + Caddy for automatic HTTPS; the database does not expose a port; `/metrics` is hidden from the internet), `Caddyfile`, `.env.example`, `backup.sh` (daily dump + off-server copy) and `restore-test.sh` (proves a backup can be restored into a temporary database). Step-by-step guide: `docs/15-deployment.md`.

### Changed

- `prisma` (the migration CLI) moved to `dependencies` so that `prisma migrate deploy` can run in the production image.

## [1.8.1] — 2026-10-18

> **Upgrade note (important):** there is no database migration. **Before deploying**, check the production `.env`: the server now **refuses to start** if `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are short (< 32 characters), identical to each other, or still example values, or if `DATABASE_URL` still holds example credentials. Also set `TRUST_PROXY` (the number of reverse proxies in front of the API, usually `1`), `PUBLIC_BASE_URL`, and, if you use Grafana, `METRICS_TOKEN` + `LOG_FILE`. Full list: `docs/14-production-checklist.md`.
> **App compatibility:** older app versions keep working. 500 responses now have the shape `{ code, message, requestId }`.

### Security

- **The server stops on a dangerous production configuration**: example/short/identical JWT secrets, or example database credentials (`src/config/validate-env.ts`). Other risky settings (e.g. an empty `TRUST_PROXY`) are logged as warnings at startup.
- **`TRUST_PROXY`** (new): the number of reverse proxies in front of the API. Without it, behind a proxy all users appear to share a single IP, so a few failed logins could lock out every store. See `docs/14-production-checklist.md`.
- 500 responses no longer leak internal error messages in production; they return `code: INTERNAL_ERROR` and `requestId`. Every response carries an `X-Request-Id` header.
- `helmet` (security headers) and removal of `X-Powered-By`.
- Login lockout is now per address **and** per account, with a bounded size (previously an unbounded map), and the response time for a nonexistent account matches that of a wrong PIN.
- `POST /auth/check-credential`: its own rate limit (30 per 15 minutes) and it only returns `id`, `name`, `role`, `avatarUrl` (without `storeId`/`branchId`).

### Added

- **Grafana monitoring.** `GET /metrics` (Prometheus, requires `Authorization: Bearer <METRICS_TOKEN>`; disabled in production when the token is empty) with request duration per route pattern, checkout (online/offline, error code), login, `cashiermu_db_up`, and Node metrics. Structured JSON logs (`LOG_FILE`) contain `requestId`, route, status, and duration (without URL/body/name/phone). The `monitoring/` folder: `docker-compose.yml` (Prometheus, Loki, Alloy, Grafana), two dashboards (Backend, App), 8 alert rules, and Alloy configuration for local and Grafana Cloud. Run `npm run monitoring:up`. See `docs/13-monitoring.md`.
- New variables: `TRUST_PROXY`, `METRICS_TOKEN`, `LOG_LEVEL`, `LOG_FILE`. `morgan` was replaced by structured logging.

## [1.8.0] — 2026-10-18

> **Upgrade note (important):** this release brings **1 database migration** (`20261023100000_offline_sales`, only adds columns; existing data is intact). Back up the database, then run `npx prisma migrate deploy` before starting the new server.
> **App compatibility:** older app versions keep working; offline mode requires app ≥ 1.8.0.

### Added

- **Offline transactions.** Migration `20261023100000_offline_sales` adds `Transaction.syncedAt`, `offlineReceiptNumber` and `offlineIssues`. `POST /transactions` accepts an optional `offline: { createdAt, receiptNumber }` block for transactions created while the phone was offline and submitted later:
  - The transaction time is stored as the original event time (it may not be more than 5 minutes in the future, `OFFLINE_SALE_IN_FUTURE`; or more than 30 days old, `OFFLINE_SALE_TOO_OLD`).
  - A changed price still uses the price the customer saw, **only if** the product/store settings were actually changed after the transaction happened; otherwise it is still `PRICE_CHANGED`. Recorded as `PRICE_ADJUSTED`.
  - Stock may go negative (`STOCK_NEGATIVE`) and an already-closed shift still accepts its transactions (`SHIFT_CLOSED`); all of these are recorded in `offlineIssues` for the owner to review.
  - The official receipt number is assigned by the server; the temporary number from the phone is stored in `offlineReceiptNumber`. The same idempotency key never creates a duplicate transaction. See `docs/12-offline-sales.md`.

## [1.7.0] — 2026-10-18

> **Upgrade note (important):** this release brings **1 database migration** (`20261022100000_expenses`, only adds a table and an enum; existing data is intact). Back up the database, then run `npx prisma migrate deploy` before starting the new server.
> **App compatibility:** older app versions keep working (the new fields on `/reports/profit` are additive only); the expenses, net profit, and employee performance features require app ≥ 1.7.0.

### Added

- **Expenses and net profit** (owner only). Migration `20261022100000_expenses` adds the `Expense` table (fixed categories: rent, salaries, electricity/water/internet, transportation, promotion, supplies, other) and the `ExpenseCategory` enum. Stock purchased for resale is **not** an expense (it is already part of COGS).
  - `GET/POST /expenses`, `PATCH/DELETE /expenses/:id`. The submitted branch must belong to the store (`422 BRANCH_NOT_FOUND`).
  - `GET /reports/profit` now returns `expenses`, `netProfit` and `netMarginPct` (`null` when filtered by employee, because expenses are not attributable to a cashier).
- **Employee performance** — `GET /reports/employee-performance`: net sales, average per transaction, gross profit, share of sales, and voided transactions per employee.
- **Table export** — `GET /reports/export/:dataset` (`transactions`, `expenses`, `employees`; max. 5,000 rows, WIB time). Text starting with `=`, `+`, `-`, `@` is prefixed with `'` so it is not executed as a spreadsheet formula. See `docs/11-expenses-and-reports.md`. The PDF is generated in the app from the same table.

## [1.6.0] — 2026-10-18

> **Upgrade note (important):** this release brings **1 database migration** (`20261021100000_service_jobs_receipt_token`, only adds columns/enums; existing data is intact). Back up the database, then run `npx prisma migrate deploy` before starting the new server. Set `PUBLIC_BASE_URL` (e.g. `https://api.example.com`) so public receipt links can be shared.
> **App compatibility:** older app versions keep working; the Services order feature requires app ≥ 1.6.0.

### Added

- **Order tracking for Services.** Migration `20261021100000_service_jobs_receipt_token` adds `Transaction.customerPhone`, `jobStatus` (`pending → in_progress → ready → completed`), `jobUpdatedAt`, `dueAt` and `receiptToken` (+ the `JobStatus` enum). Only `service` stores get a `jobStatus`; other business types are unchanged. Payment status and job status are separate.
  - `POST /transactions` accepts `customerPhone` (8–15 digits) and `dueAt`.
  - `GET /transactions?jobStatus=open|<status>` (cashiers see the whole store for this filter so the next shift can pick up where the last left off), `PATCH /transactions/:id/job`, `POST /transactions/:id/receipt-link`. Errors: `NOT_A_JOB`, `TRANSACTION_VOIDED`.
- **Public receipt page `GET /r/:token`** (no login, random 192-bit token): business name, items, total, and the latest order status; no cashier name/internal ids; HTML is escaped, rate-limited per IP, not indexed, no scripts. Set `PUBLIC_BASE_URL` in production (empty = the link is not offered). See `docs/10-service-jobs.md`.

## [1.5.0] — 2026-10-18

### Added

- **Product import & export** (owner only), columns follow the store's business type from `sector.config.ts`:
  - `GET /products/import/template` (columns, sample values, instructions), `GET /products/export` (all items, including inactive).
  - `POST /products/import/preview` (dry run only, writes nothing) and `POST /products/import` (a single database transaction; max. 500 rows).
  - Existing SKUs are updated, not duplicated; invalid rows are skipped with a per-cell message while valid rows still go in; categories that do not exist yet are created automatically. Supports Indonesian formats (`Rp 15.000`, `Ya/Tidak`, `DD/MM/YYYY`). Variants are not included yet. See `docs/09-import-export.md`.

## [1.4.0] — 2026-10-18

> **Upgrade note (important):** this release brings **3 database migrations**. Back up the database, then run `npx prisma migrate deploy` **before** starting the new server version. The effect on existing data:
> - `20261018130000_add_cost_snapshot_track_stock_per_store_sku` — new column `TransactionItem.costPrice` (old sales rows are filled with the product's **current** purchase price, only an estimate for history), `Product.trackStock` (existing products = `true`), and SKU/barcode become unique **per store**.
> - `20261019100000_add_store_sector_product_attributes` — column `Store.sector` (existing stores = `general`) and `Product.attributes` (empty).
> - `20261020100000_three_sectors_subtype_decimal_quantity` — the `BusinessSector` enum becomes 3 values (stores using a removed type automatically become `general`), column `Store.subtype` (`default`), `Product.allowDecimalQty` (`false`), and `TransactionItem.quantity` from `Int` to `Decimal(12,3)` (existing values stay intact).
>
> Deploy the whole repo, not just `dist/` — the server reads the `docs/` folder at runtime (the `/docs` documentation site is off in production unless `DOCS_ENABLED=true` + `DOCS_PASSWORD`).
> **App compatibility:** every app version already installed can still check out. App version 1.4.0 requires this backend.

### Added

- **Gross profit report — `GET /reports/profit`** (owner only). Filters: `from`, `to` (ISO timestamps, e.g. `2026-10-01T00:00:00+07:00`), `branchId`, `userId`, `limit`. Returns `grossSales`, `discounts`, `netSales`, `cogs` (COGS), `grossProfit`, `marginPct`, tax/service charge (reported separately, not revenue), a per-employee breakdown, and best-selling products by profit. Only `paid` transactions are counted.
- **COGS stored on every sales row** (`TransactionItem.costPrice`) at checkout, so profit stays correct even if a product's purchase price changes later.
- **`Product.trackStock`** (default `true`). When `false` (services / unlimited stock): checkout neither checks nor decrements stock, a void does not restore stock, and `PATCH /products/:id/stock` is rejected with `422 STOCK_NOT_TRACKED`. `stockStatus` is always `safe`.
- New product errors: `409 SKU_TAKEN` and `409 BARCODE_TAKEN`.
- New e2e tests (`test/e2e/catalog-profit.e2e.test.ts`, `helpers.ts`) and a second test account (`E2E_EMAIL_2`, `E2E_PHONE_2`) to prove isolation between stores.

- **Business sector and business type per store.** Three business sectors: **Retail / General** (`Retail / Umum`, same as before), **Culinary** (`Kuliner`: Food, Drinks, Food & Drinks), and **Services** (`Jasa & Layanan`: AC Service, Laundry, Motorcycle/Car Workshop, Massage & Reflexology, Printing & Photocopying, General Services). `Store.sector` (default `general` for all existing stores) and `Store.subtype` (text, validated against the configuration so adding a new type needs no migration).
  - A single configuration (`src/modules/sectors/sector.config.ts`) defines the terminology used by the app (Product / Menu / Service, including placeholders), units, starter categories, extra fields, variant presets, and **starter sample items** (e.g. "Cuci Kiloan Express", "Tambal Ban Tubeless", "Springbed / Kasur") that pre-fill the form except for the price. Served through **`GET /sectors`** (public, cached for 1 hour). See `docs/08-sectors.md`.
  - `POST /auth/register` accepts `sector` and `subtype` (optional; default `general` / `default`) and creates starter categories matching the business type; `422 INVALID_SUBTYPE` if the type does not match. Login/`/auth/me` return `store.sector` and `store.subtype`; the owner can change them via `PATCH /store`.
- **Cart, business, and note terminology per business type.** `vocabulary` now also contains `cartNoun` (Cart / Order / Service List), `businessNoun` (Store / Business), and `notePlaceholder` (a sample per-line note, e.g. "tanpa pewangi, ada noda di lengan kemeja" (no fragrance, stain on the shirt sleeve) for Laundry). Services no longer use the words "store", "cart", or food examples. `GET /sectors` version 4.
- **Variant terminology and examples per business type.** The section title, sample text, and variant editor placeholders are now part of each type's `vocabulary` (`variantSection`, `variantHint`, `variantGroupPlaceholder`, `variantOptionPlaceholder`), and every type has its own *Quick add* preset (e.g. Laundry: Fragrance; AC Service: AC Capacity; Workshop: Vehicle Type; Printing: Finishing, Paper Type). Services no longer show food examples such as "spice level, toppings". `GET /sectors` version 3.
- **`Product.attributes`** (JSON): business-type-specific fields (e.g. laundry: speed, estimated completion; workshop: service or spare part, brand, part number), strictly validated on the server. Unknown fields are rejected; hidden fields (`showWhen`) are dropped. Error: `422 INVALID_ATTRIBUTES` with a per-field message. Workshop, AC service, and printing distinguish **services** (no stock) from **spare parts/goods** (stock tracked).
- **Decimal quantities (kg, m², hours).** `Product.allowDecimalQty` and `TransactionItem.quantity` are now `Decimal(12,3)`: a laundry can sell 2.5 kg. Only for items without stock tracking (`422 DECIMAL_NEEDS_UNTRACKED_STOCK`); fractions for items that do not allow them are rejected (`422 INVALID_QUANTITY`); at most 3 digits after the decimal point. Rows with a fractional quantity are rounded to whole Rupiah (2.333 kg × 7,000 = 16,331); whole-number rows are calculated exactly as before.
- **Edit product variants via `PATCH /products/:id`** (`variantGroups` holds the complete list; unchanged ids are preserved so carts/receipts remain valid; ids belonging to another product are rejected with `422 INVALID_VARIANT_ID`).
- `AppError(status, code, message, details?)` in `src/utils/app-error.ts`, handled by `errorHandler`.
- Tests: configuration validation and integrity (unit; every sample item is validated against its own type), decimal quantities (unit + e2e), e2e for business type/attributes/variants (`test/e2e/sectors.e2e.test.ts`), a third test account (`E2E_EMAIL_3`, `E2E_PHONE_3`), and an e2e token cache so tests do not hit the login rate limit.

### Changed

- **SKU and barcode are now unique per store**, not global (different stores may use the same SKU/barcode).
- Voiding a transaction only restores stock for products with `trackStock = true`.
- Migration: `20261018130000_add_cost_snapshot_track_stock_per_store_sku`
  - **Backfill:** old sales rows are filled with the product's **current** purchase price. This is only an estimate for history (the purchase price at the time was never stored); all new sales use the real COGS.
  - App compatibility: all app versions keep working. Existing products automatically get `trackStock = true`. The "Lacak stok" (Track stock) toggle and the profit card are in the latest app version.

- **`GET /products` now returns `variantGroups` together with their options.** Previously variants were not sent, so the variant picker at the cashier never appeared.
- `trackStock` on `POST /products` is now optional: if not sent, the sector default is used (services = no stock tracking; Beauty "Layanan" (Services) = no stock tracking).
- Checkout: `selectedVariants` only needs to contain `optionId`; other fields are accepted but ignored (the server always computes variant prices from the database).
- `PATCH /products/:id` and `POST /products` accept `allowDecimalQty`; `GET /reports/top-products` and `GET /reports/profit` return decimal quantities (numbers, not strings).
- Migrations: `20261019100000_add_store_sector_product_attributes` and `20261020100000_three_sectors_subtype_decimal_quantity`
  - The second migration shrinks the `BusinessSector` enum to three values; stores using a removed type (`fashion`, `beauty`, `craft`, never released) automatically become `general`, their products unchanged. The `TransactionItem.quantity` column changes from `Int` to `Decimal(12,3)` (existing values stay intact).
  - App compatibility: all app versions keep working. Existing stores automatically become `general` / `default` (no extra fields); old apps that do not send `sector`/`subtype`/`attributes` can still register and create products. The business type picker, dynamic terminology, dynamic product form, sample items, variant editor, and decimal quantity input are in the latest app version.

### Fixed

- **A product's `categoryId` must now belong to the same store** (`422 CATEGORY_NOT_FOUND`). Previously a product could be linked to another store's category.

## [1.3.0] — 2026-10-18

> **Upgrade note:** this release brings 2 database migrations. Run `npx prisma migrate deploy` (after a backup) **before** starting the new server version. Deploy the whole repo, not just `dist/` — the server reads the `docs/` folder at runtime.
> **App compatibility:** every app version already installed can still check out as long as the prices in the app are in sync with the server. Full support (`Idempotency-Key`, `PRICE_CHANGED` handling, double-tap guard) is in the latest app version.

### Added

- **Developer documentation site at `/docs`** — per-page menu, table of contents, and syntax-highlighted code. Active in development; off in production unless `DOCS_ENABLED=true` and `DOCS_PASSWORD` is required (HTTP Basic auth). New env vars: `DOCS_ENABLED`, `DOCS_USER`, `DOCS_PASSWORD`.
- `POST /transactions` accepts an `Idempotency-Key` header; a repeated request with the same key returns the original transaction (status `200` + header `Idempotent-Replayed: true`), without charging twice.
  - Migration: `20261018120000_add_transaction_idempotency_key`
  - App compatibility: works with all app versions; the latest app sends the key.
- Developer guide (`docs/`), ESLint, Prettier, Husky (pre-commit, commit-msg, pre-push), commitlint, and tests (Vitest: unit + e2e).

### Changed

- Checkout recalculates all prices on the server. Prices from an outdated app are rejected with `409 PRICE_CHANGED` (containing per-row `details`). Checkout errors now have the shape `{ code, message, details? }`.
- Stock is decremented atomically (`stock >= qty`), the same product may appear in multiple cart rows, and `shiftId`/`branchId` are validated as belonging to the same store and user.
- Cash payments are recorded net of change, so shift totals and the payment method report are not inflated.
- `invoiceNumber` is now unique per store, not global.
  - Migration: `20261018121000_scope_invoice_number_per_store`
- The change total (`changeAmount`) and `cashPaid` on transactions are now computed by the server from the cash payment entries.

### Deprecated

- The `cashPaid` field in the `POST /transactions` body: now derived from payments of type `cash`. Still accepted so old apps do not break; planned for removal in 2.0.0.

### Fixed

- Logging in twice within the same second failed with `409` because of identical refresh tokens; every token is now unique (`jti`).

## [1.2.0] — 2026-10-16

### Added

#### Optional Shift per Store (`shiftEnabled` flag)
- **File:** `prisma/schema.prisma` — `Transaction.shiftId` changed from `String` → `String?` (nullable)
- **File:** `src/modules/transactions/transactions.schema.ts` — `shiftId` becomes `.uuid().nullable().optional()`
- **File:** `src/modules/transactions/transactions.controller.ts` — conditional logic:
  - `store.shiftEnabled = true` → `shiftId` is required + the shift must have status `open`, `branchId` is taken from the shift
  - `store.shiftEnabled = false` → skip shift validation, `branchId` from `body.branchId ?? user.branchId`
  - Updating shift totals (cashSalesTotal, digitalSalesTotal, transactionCount) only happens if `shiftId` is non-null
  - Voiding a transaction: reverse shift totals only if `shiftId` is non-null on the record
- **Migration:** `20261004093150_make_transaction_shiftid_nullable`

#### Login & Me — Shift Information in the Response
- **File:** `src/modules/auth/auth.controller.ts`
- `POST /auth/login` and `GET /auth/me` now return:
  ```json
  {
    "user": { "id", "name", "role", "branchId", "avatarUrl", "storeId" },
    "store": { "id", "name", "shiftEnabled", "currency", "currencySymbol" },
    "requireShift": true | false,
    "activeShift": { "id", "branchId", "type", "startedAt", "openingBalance" } | null,
    "accessToken": "...",
    "refreshToken": "..."
  }
  ```
- `requireShift = (role !== 'owner') && store.shiftEnabled` — the owner never needs a shift
- `activeShift` is only queried if `requireShift = true`
- The FE needs no additional API call after login to determine whether a shift must be opened

#### Automatic Default Categories on Register
- **File:** `src/modules/auth/auth.controller.ts`
- `POST /auth/register` now creates 5 default categories within a single `prisma.$transaction`:
  Makanan, Minuman, Snack, Rokok, Lainnya
- Previously: no categories were created when a new store was created

#### StoreDiscount CRUD (`/api/v1/discounts`)
- **File:** `src/modules/discounts/` (controller, schema, routes)
- New `StoreDiscount` model in Prisma: `id, storeId, label, type(percent|amount), value, isActive, sortOrder`
- Endpoints: `GET /` (all roles), `POST /`, `PATCH /:id`, `DELETE /:id` (owner only)
- Cascade delete from Store

#### Discount Fields on Store & Product
- **File:** `prisma/schema.prisma`
- `Store` — added: `globalDiscountEnabled`, `globalDiscountType`, `globalDiscountValue`, `cashierCanDiscount`
- `Product` — added: `discountEnabled`, `discountType(percent|amount)`, `discountValue`
- **File:** `src/modules/store/store.schema.ts` — new fields go into `updateStoreSchema`
- **File:** `src/modules/products/products.schema.ts` — new fields go into `createProductSchema`

#### Item-level Discount in Transactions
- **File:** `src/modules/transactions/transactions.schema.ts`
- Added `itemDiscountSchema` (`type`, `value`, `label`) — nullable/optional per transaction item
- `transactionItemSchema` now has `itemDiscount` and `subtotal` fields (optional from the FE)

---

### Fixed

#### Zod Coercion for Decimal Fields (Fix for update 422)
- **Files:** all `*.schema.ts`
- All numeric fields mapped to Prisma `Decimal` changed from `z.number()` → `z.coerce.number()`
- **Root cause:** Prisma serializes `Decimal` as a `string` in the JSON response (e.g. `"20000.00"`). When the FE sends this data back on update, `z.number()` rejects the string → 422 Unprocessable Entity
- Files changed: `products.schema.ts`, `shifts.schema.ts`, `transactions.schema.ts`, `pending-bills.schema.ts`, `store.schema.ts`, `categories.schema.ts`

#### `updateProduct` Response Incomplete
- **File:** `src/modules/products/products.controller.ts`
- `PATCH /products/:id` now returns `include: { category }` + the `stockStatus` field
- Previously: the response was just the raw product without the category object

#### storeId Inconsistent in Update Operations
- **Files:** `products.controller.ts`, `branches.controller.ts`, `users.controller.ts`
- `adjustStock`, `branches.toggleStatus`, `users.toggleStatus`, `users.changePin` — the update query now uses `where: { id, storeId }` instead of just `where: { id }`
- Previously: storeId was only checked in the preceding `findUnique`; the update itself was not scoped to storeId

#### `GET /shifts/current` Returned 404 When There Was No Shift
- **File:** `src/modules/shifts/shifts.controller.ts`
- Now returns `null` with status 200 if there is no active shift
- **Root cause:** the 404 made the FE error handler misread it as "resource not found" when "no shift" is a valid state

#### Category Delete — Null Constraint Violation
- **File:** `src/modules/categories/categories.controller.ts`
- **Root cause:** `categoryId` on `Product` is a `String` (non-nullable). The previous code tried `data: { categoryId: fallback?.id ?? null }` → TypeScript error + Prisma runtime error
- Fix: if there are products in the category being deleted:
  - A "Lainnya" (Other) category exists → move the products to "Lainnya", delete the category
  - No "Lainnya" → return 400 with an informative message, block the delete

#### `logoUrl` Could Not Be Updated via PATCH /store
- **File:** `src/modules/store/store.schema.ts`
- Added `logoUrl: z.string().nullable().optional()` to `updateStoreSchema`
- Previously: Zod stripped this field → logoUrl was not saved

---

### Changed

#### Seed — Cleaned of Demo Data
- **File:** `prisma/seed.ts`
- **Removed:** seed Branch, User (budi/siti/ahmad), all Products (10 items)
- **Kept:** store-default + 5 categories
- **Changed:** category IDs from the `'cat-makanan'` style → proper UUIDs (hardcoded, stable)
  ```
  Makanan:  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
  Minuman:  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12
  ...
  ```
- **Impact:** Developers must register via `POST /auth/register` to get an account — there are no built-in accounts anymore

#### `GET /auth/me` — Response Structure Changed
- Previously: returned a flat user object
- Now: returns `{ user, store, requireShift, activeShift }` (same as the login response)

---

## [Unreleased] — Session: 2026-10-05

### Fixed

#### transactions.controller.ts — Invoice Number Unique Constraint Error (P2002)
- **File:** `src/modules/transactions/transactions.controller.ts`
- Added import of `{ Prisma }` from `@prisma/client`.
- Replaced the single `prisma.$transaction()` call with a **retry loop** (max 3 attempts) that catches `PrismaClientKnownRequestError` with `code === 'P2002'`:
  - If P2002 (unique constraint on `invoiceNumber`) → generate a new invoice number and retry.
  - If any other error → re-throw immediately, no retry.
  - After 3 failures → throw the last error to `next(err)` → `errorHandler` returns 409.
- **Root cause:** `generateInvoiceNumber` used `COUNT + 1`, which is not atomic. Two requests arriving almost simultaneously (user double-tap) read the same `count` → generate the same `invoiceNumber` → the second request hits P2002.

#### utils/invoice.ts — Invoice Number Collision Across Branches / Stores
- **File:** `src/utils/invoice.ts`
- Changed signature: `generateInvoiceNumber(branchId)` → `generateInvoiceNumber(storeId)`.
- Changed the strategy from **COUNT-based** to **MAX-based**:
  ```
  BEFORE: count(branchId, today) + 1
  AFTER: parse the sequence from the last invoiceNumber today (storeId, startsWith prefix) + 1
  ```
- Filters using `invoiceNumber: { startsWith: prefix }` (not a `createdAt` date range) to avoid timezone mismatch between server UTC and local time.
- **Root cause 1 (cross-branch):** `invoiceNumber @unique` is global in the Prisma schema, but the count is filtered per `branchId`. Two different branches that both create their first transaction today would generate `INV-YYYYMMDD-0001` → collision.
- **Root cause 2 (ineffective retry):** the COUNT-based approach always produced the same invoice number on every retry because failed inserts are rolled back → the count does not change → the generated value is identical on every attempt → all 3 retries fail.
- **Solution:** MAX-based always reads the highest committed `invoiceNumber` → the generated value always differs from existing records → the retry is effective against concurrent race conditions.

---

## [1.0.0] — Prior to 2026-10-05

### Added
- REST API with Express.js + TypeScript + Prisma ORM (PostgreSQL).
- Modules: `auth`, `branches`, `categories`, `pending-bills`, `products`, `reports`, `shifts`, `store`, `transactions`, `users`.
- JWT authentication middleware (`authenticate.ts`).
- Role-based access control (`requireRole.ts`).
- Zod schema validation (`validate.ts`).
- Global error handler (`errorHandler.ts`) with handling of Prisma error codes P2002, P2025.
- Invoice number generator (`utils/invoice.ts`).
- Multi-tenant: all resources are scoped per `storeId` from the JWT payload.
- Shift management: active shift validation before transactions, totals updated on transaction/void.
- Transaction void: owner PIN verification (bcrypt), restore stock, reverse shift totals.
