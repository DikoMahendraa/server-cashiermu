# Changelog — CashierMu API (Backend)

Semua perubahan signifikan pada project ini didokumentasikan di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **Situs dokumentasi developer di `/docs`** — menu per halaman, daftar isi, dan kode berwarna. Aktif di development; di production mati kecuali `DOCS_ENABLED=true` dan wajib `DOCS_PASSWORD` (HTTP Basic auth). Env baru: `DOCS_ENABLED`, `DOCS_USER`, `DOCS_PASSWORD`.
- `POST /transactions` menerima header `Idempotency-Key`; request ulang dengan key yang sama mengembalikan transaksi awal (status `200` + header `Idempotent-Replayed: true`), tidak menagih dua kali.
  - Migration: `20261018120000_add_transaction_idempotency_key`
  - Kompatibilitas app: jalan dengan semua versi app; app terbaru mengirim key.
- Panduan developer (`docs/`), ESLint, Prettier, Husky (pre-commit, commit-msg, pre-push), commitlint, dan test (Vitest: unit + e2e).

### Changed

- Checkout menghitung ulang semua harga di server. Harga dari app yang sudah usang ditolak dengan `409 PRICE_CHANGED` (berisi `details` per baris). Error checkout kini berbentuk `{ code, message, details? }`.
- Stok dikurangi atomik (`stock >= qty`), produk yang sama boleh muncul di beberapa baris keranjang, `shiftId`/`branchId` divalidasi milik store dan user yang sama.
- Pembayaran tunai dicatat bersih dari kembalian, sehingga total shift dan laporan metode bayar tidak membengkak.
- `invoiceNumber` kini unik per store, bukan global.
  - Migration: `20261018121000_scope_invoice_number_per_store`
- `cashPaid` pada body checkout sekarang diturunkan dari pembayaran tunai (field lama masih diterima).

### Fixed

- Login dua kali dalam detik yang sama gagal `409` karena refresh token identik; setiap token kini unik (`jti`).

## [1.2.0] — 2026-10-16

### Added

#### Shift Opsional per Store (`shiftEnabled` flag)
- **File:** `prisma/schema.prisma` — `Transaction.shiftId` diubah dari `String` → `String?` (nullable)
- **File:** `src/modules/transactions/transactions.schema.ts` — `shiftId` jadi `.uuid().nullable().optional()`
- **File:** `src/modules/transactions/transactions.controller.ts` — logika kondisional:
  - `store.shiftEnabled = true` → `shiftId` wajib ada + shift harus status `open`, `branchId` diambil dari shift
  - `store.shiftEnabled = false` → skip validasi shift, `branchId` dari `body.branchId ?? user.branchId`
  - Update shift totals (cashSalesTotal, digitalSalesTotal, transactionCount) hanya dilakukan jika `shiftId` non-null
  - Void transaksi: reverse shift totals hanya jika `shiftId` non-null pada record
- **Migration:** `20261004093150_make_transaction_shiftid_nullable`

#### Login & Me — Informasi Shift dalam Response
- **File:** `src/modules/auth/auth.controller.ts`
- `POST /auth/login` dan `GET /auth/me` sekarang return:
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
- `requireShift = (role !== 'owner') && store.shiftEnabled` — owner tidak pernah butuh shift
- `activeShift` hanya di-query jika `requireShift = true`
- FE tidak perlu API call tambahan setelah login untuk menentukan apakah perlu buka shift

#### Kategori Default Otomatis saat Register
- **File:** `src/modules/auth/auth.controller.ts`
- `POST /auth/register` sekarang membuat 5 kategori default dalam satu `prisma.$transaction`:
  Makanan, Minuman, Snack, Rokok, Lainnya
- Sebelumnya: tidak ada kategori saat store baru dibuat

#### StoreDiscount CRUD (`/api/v1/discounts`)
- **File:** `src/modules/discounts/` (controller, schema, routes)
- Model baru `StoreDiscount` di Prisma: `id, storeId, label, type(percent|amount), value, isActive, sortOrder`
- Endpoint: `GET /` (semua role), `POST /`, `PATCH /:id`, `DELETE /:id` (owner only)
- Cascade delete dari Store

#### Field Diskon di Store & Produk
- **File:** `prisma/schema.prisma`
- `Store` — tambah: `globalDiscountEnabled`, `globalDiscountType`, `globalDiscountValue`, `cashierCanDiscount`
- `Product` — tambah: `discountEnabled`, `discountType(percent|amount)`, `discountValue`
- **File:** `src/modules/store/store.schema.ts` — field baru masuk ke `updateStoreSchema`
- **File:** `src/modules/products/products.schema.ts` — field baru masuk ke `createProductSchema`

#### Item-level Discount di Transaksi
- **File:** `src/modules/transactions/transactions.schema.ts`
- Tambah `itemDiscountSchema` (`type`, `value`, `label`) — nullable/optional per item transaksi
- `transactionItemSchema` sekarang punya field `itemDiscount` dan `subtotal` (opsional dari FE)

---

### Fixed

#### Zod Coercion untuk Decimal Fields (Fix update 422)
- **Files:** semua `*.schema.ts`
- Semua field numerik yang mapped ke Prisma `Decimal` diubah dari `z.number()` → `z.coerce.number()`
- **Root cause:** Prisma serialisasi `Decimal` sebagai `string` di JSON response (misal `"20000.00"`). Saat FE mengirim data ini kembali saat update, `z.number()` menolak string → 422 Unprocessable Entity
- File yang diubah: `products.schema.ts`, `shifts.schema.ts`, `transactions.schema.ts`, `pending-bills.schema.ts`, `store.schema.ts`, `categories.schema.ts`

#### `updateProduct` Response Tidak Lengkap
- **File:** `src/modules/products/products.controller.ts`
- `PATCH /products/:id` sekarang return `include: { category }` + `stockStatus` field
- Sebelumnya: response hanya raw product tanpa category object

#### storeId Tidak Konsisten di Update Operations
- **Files:** `products.controller.ts`, `branches.controller.ts`, `users.controller.ts`
- `adjustStock`, `branches.toggleStatus`, `users.toggleStatus`, `users.changePin` — update query sekarang pakai `where: { id, storeId }` bukan hanya `where: { id }`
- Sebelumnya: storeId hanya dicek di `findUnique` sebelumnya, update sendiri tidak scope ke storeId

#### `GET /shifts/current` Return 404 saat Tidak Ada Shift
- **File:** `src/modules/shifts/shifts.controller.ts`
- Sekarang return `null` dengan status 200 jika tidak ada shift aktif
- **Root cause:** 404 menyebabkan FE error handler salah baca sebagai "resource not found" padahal "tidak ada shift" adalah state yang valid

#### Category Delete — Null Constraint Violation
- **File:** `src/modules/categories/categories.controller.ts`
- **Root cause:** `categoryId` di `Product` adalah `String` (non-nullable). Code sebelumnya mencoba `data: { categoryId: fallback?.id ?? null }` → TypeScript error + runtime error Prisma
- Fix: jika ada produk di kategori yang dihapus:
  - Ada kategori "Lainnya" → pindah produk ke "Lainnya", hapus kategori
  - Tidak ada "Lainnya" → return 400 dengan pesan informatif, block delete

#### `logoUrl` Tidak Bisa Diupdate via PATCH /store
- **File:** `src/modules/store/store.schema.ts`
- Tambah `logoUrl: z.string().nullable().optional()` ke `updateStoreSchema`
- Sebelumnya: Zod strip field ini → logoUrl tidak tersimpan

---

### Changed

#### Seed — Bersih dari Data Demo
- **File:** `prisma/seed.ts`
- **Dihapus:** seed Branch, User (budi/siti/ahmad), semua Product (10 item)
- **Dipertahankan:** store-default + 5 kategori
- **Diubah:** category ID dari `'cat-makanan'` style → UUID proper (hardcoded stabil)
  ```
  Makanan:  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
  Minuman:  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12
  ...
  ```
- **Impact:** Developer harus register via `POST /auth/register` untuk mendapat akun — tidak ada lagi akun bawaan

#### `GET /auth/me` — Struktur Response Berubah
- Sebelumnya: return flat user object
- Sekarang: return `{ user, store, requireShift, activeShift }` (sama dengan login response)

---

## [Unreleased] — Session: 2026-10-05

### Fixed

#### transactions.controller.ts — Invoice Number Unique Constraint Error (P2002)
- **File:** `src/modules/transactions/transactions.controller.ts`
- Tambah import `{ Prisma }` dari `@prisma/client`.
- Ganti single `prisma.$transaction()` call dengan **retry loop** (max 3 attempts) yang menangkap `PrismaClientKnownRequestError` dengan `code === 'P2002'`:
  - Jika P2002 (unique constraint pada `invoiceNumber`) → generate invoice number baru dan retry.
  - Jika error lain → re-throw immediately, tidak di-retry.
  - Setelah 3 kali gagal → throw error terakhir ke `next(err)` → `errorHandler` return 409.
- **Root cause:** `generateInvoiceNumber` menggunakan `COUNT + 1` yang tidak atomic. Dua request yang tiba hampir bersamaan (double-tap user) membaca `count` yang sama → generate `invoiceNumber` yang sama → request kedua kena P2002.

#### utils/invoice.ts — Invoice Number Collision Lintas Branch / Store
- **File:** `src/utils/invoice.ts`
- Ubah signature: `generateInvoiceNumber(branchId)` → `generateInvoiceNumber(storeId)`.
- Ganti strategi dari **COUNT-based** ke **MAX-based**:
  ```
  SEBELUM: count(branchId, today) + 1
  SESUDAH: parse sequence dari invoiceNumber terakhir hari ini (storeId, startsWith prefix) + 1
  ```
- Filter menggunakan `invoiceNumber: { startsWith: prefix }` (bukan `createdAt` date range) untuk menghindari timezone mismatch antara server UTC dan local time.
- **Root cause 1 (lintas branch):** `invoiceNumber @unique` secara global di schema Prisma, tapi count di-filter per `branchId`. Dua branch berbeda yang sama-sama membuat transaksi pertama hari ini akan generate `INV-YYYYMMDD-0001` → collision.
- **Root cause 2 (retry tidak efektif):** COUNT-based approach selalu menghasilkan invoice number yang sama pada setiap retry karena failed inserts di-rollback → count tidak berubah → nilai yang di-generate identik di setiap attempt → semua 3 retry gagal.
- **Solusi:** MAX-based selalu membaca `invoiceNumber` tertinggi yang sudah committed → nilai yang di-generate selalu beda dari record yang sudah ada → retry efektif untuk concurrent race condition.

---

## [1.0.0] — Prior to 2026-10-05

### Added
- REST API dengan Express.js + TypeScript + Prisma ORM (PostgreSQL).
- Modul: `auth`, `branches`, `categories`, `pending-bills`, `products`, `reports`, `shifts`, `store`, `transactions`, `users`.
- JWT authentication middleware (`authenticate.ts`).
- Role-based access control (`requireRole.ts`).
- Zod schema validation (`validate.ts`).
- Global error handler (`errorHandler.ts`) dengan handling Prisma error codes P2002, P2025.
- Invoice number generator (`utils/invoice.ts`).
- Multi-tenant: semua resource di-scope per `storeId` dari JWT payload.
- Shift management: validasi shift aktif sebelum transaksi, update totals saat transaksi/void.
- Transaction void: verifikasi PIN owner (bcrypt), restore stock, reverse shift totals.
