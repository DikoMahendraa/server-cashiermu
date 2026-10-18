# Import & export products

Owners can download a spreadsheet template, fill it in Excel/Google Sheets, upload it, and export all items again.
The columns come from the **same sector config** as the product form (`src/modules/sectors/sector.config.ts`), so a
laundry store gets a "Kecepatan" column and a retail store does not. Code lives in `src/modules/products/import/`.

## Endpoints (owner only)

| Method | Path                           | What it does                                                     |
| ------ | ------------------------------ | ---------------------------------------------------------------- |
| GET    | `/products/import/template`    | Headers, example rows and a "Petunjuk" list for the store's kind |
| GET    | `/products/export`             | Every product (including inactive) in the same column layout     |
| POST   | `/products/import/preview`     | Plans the import. **Writes nothing.**                            |
| POST   | `/products/import`             | Plans again and writes everything valid in one transaction       |

The body of both POST endpoints is `{ headers: string[], rows: Record<string, string|number|boolean|null>[] }`
(max 500 rows, 2 MB). The **app parses the file**; the **server is the only validator**.

## How a row is decided

`planImport()` (pure, no database) returns one result per row:

- `create` — new SKU. A blank SKU is derived from the name (readable slug).
- `update` — SKU already exists in this store; only known columns are compared, so unrelated data is kept.
- `unchanged` — nothing differs (exporting and re-importing is a no-op).
- `error` — messages are per cell and numbered like the Excel row. Bad rows are skipped, valid rows still import.

Missing categories are created automatically and listed in `newCategories` in the preview. Unknown columns are reported in
`ignoredColumns` and ignored. Values accept Indonesian formats (`Rp 15.000`, `15.000,50`, `Ya/Tidak`, `DD/MM/YYYY`, Excel dates).

## Rules worth remembering

- Everything is scoped by `storeId`; the same SKU in another store is a different item.
- Preview never writes; commit recomputes the plan, so a stale preview cannot apply old decisions.
- Variants are **not** part of import/export yet.
- Barcodes with a leading zero need an apostrophe in Excel (`'0123`), otherwise Excel drops the zero.
- Changing a field in `sector.config.ts` changes the columns; the round-trip tests (`test/import.test.ts`) cover every kind.

## Tests

`npm test` runs `test/import.test.ts`; `npm run test:e2e` runs `test/e2e/product-import.e2e.test.ts` against the live API.
