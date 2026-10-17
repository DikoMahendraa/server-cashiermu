# 5. Code standards

The tools enforce formatting and the basic rules for you (`npm run lint`, `npm run format`). This page covers what
tools can't check: the decisions.

## Automatic (don't think about it)

- **Prettier** formats everything: single quotes, semicolons, trailing commas, 120 columns. Your editor can format on save; the commit hook also does it.
- **ESLint** blocks: `console.*` (use `logger`), unused variables (prefix with `_` if intentional), `any`, `==`, `let` that is never reassigned.
- **TypeScript `strict`**. Fix type errors; don't silence them.

## Naming

| Thing                    | Convention                         | Example                                  |
| ------------------------ | ---------------------------------- | ---------------------------------------- |
| Files                    | `kebab-case`, suffix by role       | `pending-bills.controller.ts`, `checkout.pricing.ts` |
| Variables, functions     | `camelCase`, verbs for functions   | `createTransaction`, `settlePayments`    |
| Types, classes           | `PascalCase`                       | `CheckoutError`, `CreateProductDto`      |
| Constants                | `UPPER_SNAKE_CASE`                 | `MAX_INVOICE_ATTEMPTS`                   |
| zod schemas              | `<verb><Thing>Schema`              | `createProductSchema`                    |
| DTO types                | `<Verb><Thing>Dto`, from the schema | `type CreateProductDto = z.infer<...>`  |
| Prisma models            | `PascalCase`, singular             | `Transaction`, `StoreDiscount`           |
| Prisma fields / columns  | `camelCase`                        | `invoiceNumber`, `createdAt`             |
| URL paths                | plural, `kebab-case`               | `/pending-bills`, `/transactions/:id/void` |
| JSON fields              | `camelCase`, same as Prisma        | `grandTotal`                             |
| Error codes              | `UPPER_SNAKE_CASE`, never renamed  | `PRICE_CHANGED`                          |
| Env vars                 | `UPPER_SNAKE_CASE`                 | `JWT_ACCESS_SECRET`                      |

## TypeScript

- No `any`. Use `unknown` and narrow it, or write the type. (Tests may use `any` for fakes.)
- Don't use `!` (non-null assertion) except `req.user!` after `authenticate`, which guarantees it.
- Prefer `const`; small pure functions; return early instead of nesting.
- Type the return of exported functions (`Promise<void>` for handlers).
- Import with the `@prisma/client` types (`Prisma.TransactionGetPayload<...>`) rather than re-declaring shapes.

## Controllers and services

- Controller: read input → call something → send response. Wrap in `try/catch` and `next(err)`.
- Business rules go in a service or a pure `*.ts` file, take dependencies as parameters (`db: PrismaClient`) so tests can fake them.
- One exported function = one job. If you need "and" to describe it, split it.

## Validation

- Validate **every** body with zod in the route (`validate(schema)`). Query/params are strings — parse them (`z.coerce`, `parsePagination`) before use.
- Set limits: `.max()` on strings, `.min()/.max()` on numbers, `.uuid()` on ids, `.max(n)` on arrays.
- Use `z.enum([...])` for fixed sets. Validation protects the database from garbage and the app from surprises.

## Money

Money bugs are the most expensive bugs in a POS.

- DB columns are `Decimal(15,2)`. Prisma returns `Decimal` objects → `Number(value)` before math or JSON.
- Rupiah in practice are whole numbers. Round **once**, at a documented step, with the same rule as the app (`Math.floor` for tax/service charge and discount amounts).
- **Never trust totals, prices, subtotals or change from the client.** Recompute on the server from database prices.
- Compare money with a tolerance (`> 0.01`), never `===` on computed floats.
- Anything that changes money math needs unit tests with real numbers, and must match the mobile app (change both).

## Database

- Always filter by `storeId` (see [Architecture](03-architecture.md#multi-tenancy-the-most-important-rule)).
- Multiple writes that must succeed together → `prisma.$transaction`. Inside, use **conditional updates** for races: `updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })` and check `count`.
- Don't read-then-write for counters/stock. Let the database do `increment`/`decrement`.
- Select only what you need on big tables; never return `pinHash` or token columns (use `select`).
- No raw SQL unless you must; if you do, use Prisma's parameterised `$queryRaw` tagged template, never string concatenation.
- **Raw SQL and dates:** Prisma stores `DateTime` as UTC in `timestamp without time zone` columns. When you compare a JS `Date` inside `$queryRaw`, wrap it as `(${date}::timestamptz AT TIME ZONE 'UTC')` (see `profit.service.ts`); otherwise the result shifts by the database's time zone and the query silently returns nothing. The ORM (`findMany({ where: { createdAt: ... } })`) does not have this problem.
- Dates are stored in UTC. Business "days" (reports, "today") are computed in the store's timezone (Asia/Jakarta by default) — do not slice `toISOString()` for a day boundary.

## Errors and logging

- Throw typed errors with a stable `code` for expected failures (out of stock, price changed). Let unexpected ones reach `errorHandler`.
- Error messages for users are Indonesian and never include internals (SQL, stack traces, ids of other stores).
- Log with `logger` (winston). **Never log** PINs, tokens, `Authorization` headers, full request bodies of auth routes, or password hashes.
- Use levels: `error` (broke something), `warn` (suspicious/recovered), `info` (key business events). No `console.log`.

## Security checklist (use it in every PR)

- [ ] Route has `authenticate`; owner-only actions have `requireRole('owner')`
- [ ] Every query is scoped by `req.user.storeId`; foreign ids are verified to belong to the store
- [ ] Input validated with zod; no mass-assignment (`data: req.body` only after a schema that lists the allowed fields)
- [ ] No secrets in code or git; new env vars added to `.env.example` and `src/config/env.ts`
- [ ] Sensitive fields (`pinHash`, tokens) never returned
- [ ] Money is recomputed server-side
- [ ] Rate limiting considered for anything guessable (login, PIN, OTP)
- [ ] `npm audit` shows nothing new at high/critical for what you added

## Tests

| Kind               | Where                   | When                                                             |
| ------------------ | ----------------------- | ---------------------------------------------------------------- |
| Unit (pure rules)  | `test/*.test.ts`        | Any calculation or decision. Fast, no database                   |
| Unit (service + fake DB) | `test/*.service.test.ts` | Flow logic with a fake Prisma; see `checkout.service.test.ts` |
| End-to-end         | `test/e2e/*.e2e.test.ts`| Critical flows against a running **local** API (`npm run test:e2e`) |

- Test names describe behaviour: `rejects a stale price with PRICE_CHANGED`.
- Cover the happy path **and** the failure paths (not found, wrong store, wrong role, duplicates, concurrency).
- A bug fix starts with a test that fails, then the fix.
- E2E tests only run against `localhost` and use the throwaway `E2E_*` account.

## Comments

Write code that explains itself; use comments for **why**, not what (a business rule, a trap, a workaround).
Comment language: English for code comments, Indonesian for user-facing messages.
Delete dead code instead of commenting it out — git remembers.

## Dependencies

- Add a package only if it saves real work; check it is maintained and small.
- Install with an exact reason in the commit: `chore(deps): add helmet for security headers`.
- Don't upgrade major versions inside a feature PR.
