# 8. Business types and kinds

CashierMu serves different kinds of shops. A store picks a **business type** (a *sector*) and a **kind** (a *subtype*)
when it registers. Together they decide what the app calls things ("Produk", "Menu" or "Layanan"), which units and
categories are offered, which extra fields an item has, and which starter examples are suggested. This page explains how
it works and how to change it.

## The idea in one minute

- One database schema for everyone. Kind-specific values live in a JSON column, `Product.attributes`.
- The **config** (`src/modules/sectors/sector.config.ts`) is the single source of truth. The **server** validates
  `attributes` against it (strictly), the **app** draws its screens from it (`GET /sectors`), and import/export templates will be
  generated from it. Edit one file, everything follows.
- Things every item has stay as normal columns: name, price, cost (`buyPrice`/HPP), SKU, barcode, unit, stock, `trackStock`,
  `allowDecimalQty`, category, variants. Only kind-specific extras go into `attributes`.

| Type (`BusinessSector`)  | Kinds (`Store.subtype`)                                                               | The app says |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------ |
| `general` — Retail/Umum  | `default` (exactly how every store behaved before sectors existed)                    | Produk       |
| `culinary` — Kuliner     | `food` Makanan · `beverage` Minuman · `food_beverage` Makanan & Minuman               | Menu         |
| `service` — Jasa & Layanan | `ac` Servis AC · `laundry` Laundry · `workshop` Bengkel Motor/Mobil · `massage` Pijat & Refleksi · `printing` Percetakan & Fotokopi · `general_service` Jasa Umum | Layanan |

`Store.subtype` is a plain string checked against the config, so **adding a kind needs no migration**. The stored value
`default` means "the type's default kind" (`general` → `default`, `culinary` → `food_beverage`, `service` → `general_service`),
so older apps that don't send a kind keep working.

Fashion, Kecantikan and Kerajinan were considered and removed; Agribisnis comes later.

## What a kind controls

| Part                | Example                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| **Vocabulary**      | `item`, `addItem`, `nameLabel`, `namePlaceholder`, `searchPlaceholder`, `emptyTitle`, `costLabel`, … (the type gives the base wording, a kind overrides only what differs, e.g. laundry's `namePlaceholder` is "Contoh: Cuci Kiloan Reguler") |
| **Units**           | laundry: kg, pcs, set, m², paket; printing: lembar, pcs, set, box, rim, m²; retail: the old list |
| **Categories**      | starter categories created at registration (editable afterwards)                                 |
| **Fields**          | extra values per item, e.g. laundry `speed`, `turnaroundHours`, `includes`; workshop `kind` (service/part), `vehicleType`, `partBrand` |
| **Variant presets** | one-tap suggestions per kind: Level Pedas (food), Sugar Level (drinks), Pewangi (laundry), Kapasitas AC (AC), Jenis Kendaraan (workshop), Finishing (printing)… |
| **Cart, business and note wording** | `cartNoun` ("Keranjang" for shops, "Pesanan" for cafés, "Daftar Layanan" for services), `businessNoun` ("Toko" for shops, "Usaha" otherwise, used in Settings) and `notePlaceholder` (the example in the per-line note box, e.g. "tanpa pewangi, ada noda di lengan kemeja…" for laundry). Tests fail if a service kind says "toko", "keranjang" or a food example |
| **Variant wording** | `variantSection`, `variantHint`, `variantGroupPlaceholder`, `variantOptionPlaceholder`: the section title, the "Contoh: …" hint and the input placeholders of the variant editor. A test fails if a service kind mentions food words |
| **Templates**       | starter items that pre-fill the form with everything **except the price** (e.g. "Cuci Kiloan Express", "Tambal Ban Tubeless", "Springbed / Kasur") |

### Items that are goods, not services

Some service kinds also sell goods (a workshop sells spare parts, a print shop sells paper). Those kinds have a `kind` select
field (`service` or `part`/`goods`) with `trackStockByValue`: choosing a service turns stock tracking off, choosing a part
or goods turns it on.

## Decimal quantities (kg, m², hour)

Laundry is priced per kilo, so a 2.5 kg load must be sellable.

- `Product.allowDecimalQty` marks an item whose quantity may be fractional (up to **3 decimals**). The app sets it from the
  unit (kg, m², jam, meter… have `decimal: true` in the kind's `units`) and the owner can change it.
- It only works together with **`trackStock = false`** (the stock column holds whole numbers). Otherwise the API returns
  `422 DECIMAL_NEEDS_UNTRACKED_STOCK`. Selling a fraction of an item that doesn't allow it returns `422 INVALID_QUANTITY`.
- **Rounding rule:** a line with a whole quantity is `unitPrice × quantity` exactly as before; a fractional line is rounded to
  a **whole Rupiah** (`2.333 kg × 7.000 = 16.331`). The mobile app uses the same rule so totals match to the Rupiah.
  Discounts then apply to the rounded line.
- `TransactionItem.quantity` is `Decimal(12,3)`. Money columns are unchanged.

## API

| Endpoint                | Who         | What                                                                              |
| ----------------------- | ----------- | --------------------------------------------------------------------------------- |
| `GET /sectors`          | public      | `{ version, sectors }`: every type with its kinds, vocabulary, units, fields, presets and templates. Cached for an hour. Public because the registration screen needs it before an account exists; it holds no store data |
| `POST /auth/register`   | public      | optional `sector` (default `general`) and `subtype` (default `default`); `422 INVALID_SUBTYPE` if the kind does not belong to the type. Creates the kind's starter categories |
| `GET /auth/me`, login   | logged in   | `store.sector` and `store.subtype`                                                |
| `PATCH /store`          | owner       | `{ sector, subtype }`. Changing only the type resets the kind to that type's default. Existing products keep their data |
| `POST/PATCH /products`  | owner       | `attributes` is validated against the store's kind (below); `allowDecimalQty`      |

Invalid attributes return `422`:

```json
{
  "code": "INVALID_ATTRIBUTES",
  "message": "Isian produk tidak valid",
  "details": { "fields": { "durationMinutes": "wajib diisi", "colour": "isian ini tidak dikenal untuk bidang usaha ini" } }
}
```

### Validation rules (`sector.validation.ts`)

- **Unknown keys are rejected**, so typos and stale data never get stored.
- **Required** fields must be present while they are visible.
- **`showWhen`** hides a field until another field has a value. Hidden fields are **dropped** (switch a workshop item from
  "part" to "service" and the old brand disappears instead of lingering).
- Blank optional values are dropped, text is trimmed, numbers/dates/choices are checked (`YYYY-MM-DD` must be a real date).
- On update, `attributes` is **replaced as a whole** when sent, and left alone when omitted.
- `trackStock` omitted on create → the select field's `trackStockByValue`, otherwise the kind's default.

## Field types

| `type`        | Stored as                | Options you can set                                  |
| ------------- | ------------------------ | ---------------------------------------------------- |
| `text`        | string (trimmed)         | `maxLength` (default 200), `placeholder`             |
| `textarea`    | string (trimmed)         | `maxLength` (default 1000)                           |
| `number`      | number                   | `min`, `max`, `unit` (shown in the UI, e.g. "menit") |
| `select`      | one option `value`       | `options` (required), `trackStockByValue`            |
| `multiselect` | array of option `value`s | `options` (required); no duplicates                  |
| `boolean`     | `true` / `false`         |                                                      |
| `date`        | `"YYYY-MM-DD"`           |                                                      |

Common options: `key`, `label`, `required`, `help`, `placeholder`, `showWhen: { field, equals }`.

## How to change things

**Add a field to a kind**

1. Add an entry to that kind's `fields` in `sector.config.ts`, e.g.
   `{ key: 'allergens', label: 'Alergen', type: 'text', maxLength: 100, placeholder: 'Kacang, susu…' }`.
2. Bump `SECTOR_CONFIG_VERSION`.
3. Run `npm test`: the integrity tests catch duplicate keys, empty option lists, a `showWhen` pointing nowhere, and a template
   that no longer validates.
4. Nothing else: no migration, no controller change. The app picks it up from `GET /sectors`.

**Add a starter template** — add `tpl(name, categoryName, unit, trackStock, attributes)` to the kind's `templates`. Tests check the
category exists, the unit is offered, the attributes validate, and `trackStock` agrees with the kind's rules.

**Add a new kind** — add an entry to the type's `subtypes` (copy a similar one). No migration. Update the table above and the changelog (MINOR release).

**Add a new type** — add the value to `enum BusinessSector` in `prisma/schema.prisma`, create a migration
(`npm run db:migrate -- --name add_xyz_sector`), add it to `SECTORS`, update the docs and changelog. A test fails until every enum value has a config.

Rules: **never rename or delete a field `key` that already holds data** (add a new key and migrate). Make new fields optional
unless every existing item can satisfy them, otherwise editing old items starts failing with `422`.

## Variants

Variants (size, spicy level, toppings…) are not kind fields; they are normal product data, but kinds can offer one-tap
**presets** (`variantPresets`) that the app turns into editable variant groups.

- `POST /products` accepts `variantGroups` (no ids). `GET /products` returns them with their options.
- `PATCH /products/:id` with `variantGroups` expects the **complete list**: entries with an `id` are updated, entries without an
  `id` are created, and existing groups/options missing from the list are deleted. Unchanged ids are kept, so carts and receipts
  that reference them stay valid. Ids that belong to another product → `422 INVALID_VARIANT_ID`.
- At checkout the server resolves each selected variant by `optionId` and prices it from the database; the other fields the app
  sends are ignored.

## Also changed with this feature

- A product's `categoryId` must belong to the caller's store (`422 CATEGORY_NOT_FOUND`). Before this, a product could be linked to
  another shop's category.
- Domain errors can be thrown anywhere as `AppError(status, code, message, details?)` (`src/utils/app-error.ts`); `errorHandler`
  renders them as `{ code, message, details? }`.
