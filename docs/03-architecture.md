# 3. Architecture

## The life of one request

Example: the app calls `POST /api/v1/transactions` (a checkout).

```
Mobile app
   │  POST /api/v1/transactions   Authorization: Bearer <accessToken>   Idempotency-Key: chk-...
   ▼
src/app.ts            cors → express.json() → morgan (logs the request)
   ▼
transactions.routes.ts
   ├─ authenticate     verifies the JWT, sets req.user = { userId, role, branchId, storeId }   (401 if bad)
   ├─ requireRole(...) optional: only 'owner' may pass                                         (403 if not)
   ├─ validate(schema) zod checks req.body, replaces it with the cleaned data                   (422 if invalid)
   ▼
transactions.controller.ts   thin: reads req.user/req.body, calls a service, sends the response
   ▼
checkout.service.ts          business rules + database work (Prisma)
   ▼
PostgreSQL
   ▼
errorHandler (src/middleware/errorHandler.ts)   anything thrown/next(err)'d ends up here
```

Frontend analogy: routes are your navigator, middleware are interceptors, the controller is a screen component that
should stay small, and the service is a hook/util holding the real logic.

## Layers and their one job

| Layer      | File                          | Does                                                    | Must NOT                                        |
| ---------- | ----------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Route      | `<feature>.routes.ts`         | Maps URL + method → middleware chain → controller       | Contain logic                                   |
| Schema     | `<feature>.schema.ts`         | zod shapes for body input + exported DTO types          | Touch the database                              |
| Controller | `<feature>.controller.ts`     | HTTP in/out: status codes, `req.user`, call service     | Hold business rules (once they exceed ~30 lines) |
| Service    | `<feature>.service.ts` (optional) | Business rules, calculations, multi-step DB work    | Know about `req`/`res`                          |
| Pure rules | `<feature>.<topic>.ts`        | Math/decisions with no I/O (e.g. `checkout.pricing.ts`) | Import Prisma — that is what makes them easy to test |

Small CRUD (categories, branches) can stay controller-only. Start a `service` file when logic is reused, long,
or needs tests. `modules/transactions/` is the reference for the bigger style.

## Multi-tenancy: the most important rule

CashierMu is multi-tenant: many shops share one database. **Every row belongs to a store**, and the store comes
**only from the JWT** (`req.user.storeId`), never from the request body, query or URL.

```ts
// ✅ right: scoped by the caller's store
prisma.product.findMany({ where: { storeId: req.user!.storeId } });
prisma.product.update({ where: { id, storeId: req.user!.storeId }, data });

// ❌ wrong: any shop can read any shop's data
prisma.product.findMany();
prisma.product.findUnique({ where: { id } });
```

Related rules:

- When a request contains an id of another record (`categoryId`, `branchId`, `shiftId`, `productId`…), **verify that record belongs to the same store** before using it. A foreign id from another shop must fail (see `checkout.service.ts`).
- New tables get a `storeId` column, a relation to `Store`, and an index on it.
- A cashier is also limited to their own branch/shifts/transactions — check `req.user.role` and `req.user.branchId` where it matters.
- Uniqueness (SKU, invoice number, names…) must be **per store**: `@@unique([storeId, sku])`, not a global `@unique`.

## Roles

| Role      | Can                                                                               |
| --------- | --------------------------------------------------------------------------------- |
| `owner`   | Everything in their store: products, users, branches, discounts, store settings, reports, void |
| `cashier` | Sell (`POST /transactions`), see their own transactions, open/close their own shift, read products/categories/discounts/branches |

Every API route needs `authenticate`. The only unauthenticated routes are `/health`, the `/auth/*` entry points
(`register`, `check-credential`, `login`, `refresh`) and the developer docs at `/docs` (off in production unless
enabled; password-protected there; serves documentation only, never store data).

Protect owner-only routes with `requireRole('owner')` in the route file. The app hides owner screens too, but
**the server is the only real protection**.

## Errors

Target format for every error response:

```json
{ "code": "INSUFFICIENT_STOCK", "message": "Stok tidak cukup untuk produk: Kopi", "details": { } }
```

- `code` — stable machine-readable string the app can switch on (`PRICE_CHANGED`, `SHIFT_NOT_OPEN`…). Never change an existing code.
- `message` — human text for the cashier (Indonesian).
- `details` — optional extra data.

How it is done today:

- Domain errors: throw a typed error carrying `status` + `code` (see `CheckoutError` in `checkout.pricing.ts`) and map it in the controller. For a new module, copy that pattern instead of writing `res.status(...).json({ message })` everywhere.
- Prisma errors fall through to `errorHandler`: `P2002` (duplicate) → 409, `P2025` (not found) → 404, anything else → 500.
- Validation failures from `validate()` → 422 with `{ errors: ... }` (older shape; keep it for now).
- Status codes: 400 malformed, 401 not logged in, 403 not allowed, 404 not found, 409 conflict/duplicate, 422 valid shape but breaks a rule, 5xx our bug.

Older controllers return only `{ message }`. When you touch one, add a `code`; do not rewrite them unprompted.

## Auth in short

1. `POST /auth/login` (credential + 6-digit PIN) → `accessToken` (15 min) + `refreshToken` (7 days, saved in DB).
2. The app sends `Authorization: Bearer <accessToken>`; `authenticate` puts the claims in `req.user`.
3. On 401 the app calls `POST /auth/refresh`, gets a new access token and retries.
4. Role/branch are baked into the access token, so a role change applies after the next refresh.

## Checkout (reference implementation)

`modules/transactions/checkout.pricing.ts` (pure rules) + `checkout.service.ts` (database flow):

- The server **recomputes every price** from the database. A stale client price → `409 PRICE_CHANGED`.
- Stock is decremented with a **conditional update** (`stock >= qty`) inside a DB transaction, so two cashiers cannot oversell.
- `Idempotency-Key` header: retrying the same key returns the original sale instead of charging twice.
- Cash is recorded **net of change** so shift totals/reports match real money in the drawer.

Money formulas deliberately mirror the mobile app (`computeUnitPrice`, `applyItemDiscount`, `getCartTotal`). If you
change a pricing rule, change **both repos in the same release**.

## Known gaps (so you don't mistake them for patterns to copy)

- List endpoints return full arrays; `utils/pagination.ts` exists but nothing uses it yet. New list endpoints should paginate.
- Reports bucket days in UTC; Indonesian shops need store-timezone days (WIB).
- Login lockout is in memory and per IP; refresh tokens are stored in plain text.
- `app.set('trust proxy', …)` is not set. Behind Railway/Render every request appears to come from the proxy, so IP-based rate limits (login, `/docs` password attempts) are shared by everyone.
- `errorHandler` returns `err.message` on 500 — it can leak internals. Throw typed errors with safe messages.
- SKU/barcode are globally unique instead of per store.
