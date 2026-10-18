# Expenses, net profit & report exports

Gross profit (step 1) is sales minus the cost of the goods sold. **Net profit** also subtracts the money the business spends
to operate: rent, salaries, electricity, and so on. All of it is owner-only.

```
netSales     = grossSales − discounts            (tax and service charge are not revenue)
grossProfit  = netSales − HPP                    (HPP = buy price stored on each sale line)
netProfit    = grossProfit − expenses
```

**Buying stock to resell is not an expense.** It becomes HPP when the item is sold; counting it twice would understate profit.

## Expenses (`src/modules/expenses/`)

| Method | Path            | What                                                                                  |
| ------ | --------------- | ------------------------------------------------------------------------------------- |
| GET    | `/expenses`     | `?from&to&category&branchId` → `{ items, total, count, truncated, byCategory }` (500 newest, totals cover all) |
| POST   | `/expenses`     | `{ category, amount, note?, spentAt?, branchId? }`                                    |
| PATCH  | `/expenses/:id` | Any of the same fields                                                                |
| DELETE | `/expenses/:id` | Hard delete (owner only)                                                              |

- Categories are a fixed list: `rent, salary, utilities, transport, promotion, supplies, other` (`expense.categories.ts`, the
  Prisma enum and the app list must match; a unit test checks the enum). A free-text `note` adds detail.
- `spentAt` is the day the money was spent. The app sends noon local time so the day never shifts across time zones.
  Dates more than a day in the future are rejected.
- `branchId = null` means the whole business; set means one branch (must belong to the store → `422 BRANCH_NOT_FOUND`).

## Net profit in `GET /reports/profit`

The response gains `expenses { total, byCategory }`, `netProfit` and `netMarginPct`.

- `branchId` filter → only expenses assigned to that branch.
- `userId` (employee) filter → expenses cannot be attributed to a cashier, so `expenses`, `netProfit` and `netMarginPct` are **`null`**.

## Employee performance

`GET /reports/employee-performance?from&to&branchId` → per employee: transactions, net sales, average sale, discounts given,
gross profit and margin, share of sales, and **voided sales** (count and value of sales they rang up that were later voided).
Employees who only have voided sales still appear. Pure logic is in `employee.report.ts`.

## Exports

`GET /reports/export/:dataset` with dataset `transactions | expenses | employees` returns
`{ dataset, title, headers, rows, truncated }`. The app turns it into `.xlsx` or `.csv`. Up to 5,000 rows (`truncated` says
when more matched). Dates are formatted in WIB.

Text cells that start with `=`, `+`, `-`, `@` or a tab are prefixed with `'` (`safeCell`): cashier-typed names and notes must
not run as spreadsheet formulas. Numbers are never changed.

The app offers these exports (plus the sales summary) in one **Export Laporan** bottom sheet as Excel, CSV or PDF. The PDF is
built on the device from the same table with `pdf-lib` (pure JavaScript, no native module), so the server never renders PDFs.

## Tests

`test/expenses.report.test.ts` (schemas, net profit, performance, export tables) and `test/e2e/expenses-reports.e2e.test.ts`
(CRUD, store isolation, net profit, performance and exports against the live API; expense data uses March 2020 so it never
mixes with real data).
