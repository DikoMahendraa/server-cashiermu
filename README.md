# CashierMu API — Backend Setup Guide

> **Developers:** coding standards, git workflow, how to add a feature and how versioning works are in [`docs/`](docs/README.md) (English).

Panduan lengkap dari nol sampai server bisa dijalankan dan diintegrasikan dengan aplikasi React Native.

---

## Daftar Isi

1. [Prasyarat](#1-prasyarat)
2. [Install PostgreSQL](#2-install-postgresql)
3. [Install pgAdmin (GUI Database)](#3-install-pgadmin-gui-database)
4. [Clone & Install Dependencies](#4-clone--install-dependencies)
5. [Setup Environment Variables](#5-setup-environment-variables)
6. [Setup Database](#6-setup-database)
7. [Jalankan Server](#7-jalankan-server)
8. [Test API](#8-test-api)
9. [Integrasi dengan React Native](#9-integrasi-dengan-react-native)
10. [Perintah Sehari-hari](#10-perintah-sehari-hari)
11. [Struktur Project](#11-struktur-project)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prasyarat

Pastikan hal-hal berikut sudah terinstall sebelum memulai:

| Tool | Versi Minimum | Cek dengan |
|------|--------------|------------|
| Node.js | 20.12.0+ | `node --version` |
| npm | 9+ | `npm --version` |
| Homebrew (Mac) | terbaru | `brew --version` |

### Install Node.js (jika belum ada)

```bash
# Install nvm (Node Version Manager) dulu
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Restart terminal, lalu install Node.js versi terbaru
nvm install 22
nvm use 22
nvm alias default 22

# Verifikasi
node --version  # harusnya v22.x.x
```

### Install Homebrew (Mac, jika belum ada)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## 2. Install PostgreSQL

PostgreSQL adalah database yang digunakan project ini. Analoginya seperti "gudang data" tempat semua informasi (produk, transaksi, user, dll) disimpan secara permanen.

### Install via Homebrew

```bash
brew install postgresql@14
```

### Jalankan PostgreSQL otomatis saat Mac hidup

```bash
brew services start postgresql@14
```

### Verifikasi PostgreSQL berjalan

```bash
pg_ctl status -D /opt/homebrew/var/postgresql@14
# Harusnya muncul: "server is running"
```

### Cek username PostgreSQL kamu

Username PostgreSQL otomatis sama dengan username Mac kamu:

```bash
whoami
# Contoh output: dikomahendra
```

> **Catatan:** Username ini yang nanti dipakai di `DATABASE_URL` di file `.env`.

---

## 3. Install pgAdmin (GUI Database)

pgAdmin adalah aplikasi visual untuk melihat dan mengelola database — seperti "Finder" tapi untuk data.

### Download

Buka [pgadmin.org/download/pgadmin-4-macos](https://www.pgadmin.org/download/pgadmin-4-macos/) dan download versi terbaru.

- Mac chip **Apple Silicon (M1/M2/M3/M4)** → download **ARM64**
- Mac chip **Intel** → download **x86_64**

> Cek chip Mac kamu: klik logo Apple → **About This Mac** → lihat bagian **Chip** atau **Processor**.

### Koneksi ke PostgreSQL lokal

Setelah pgAdmin terbuka:

1. Klik kanan **Servers** → **Register** → **Server...**
2. Tab **General** → Name: `CashierMu Local`
3. Tab **Connection**:
   - Host: `localhost`
   - Port: `5432`
   - Username: isi dengan hasil `whoami` tadi (contoh: `dikomahendra`)
   - Password: kosongkan
4. Klik **Save**

---

## 4. Clone & Install Dependencies

```bash
# Masuk ke folder project
cd server-cashiermu

# Install semua package yang dibutuhkan
npm install
```

---

## 5. Setup Environment Variables

Environment variables adalah konfigurasi rahasia yang tidak di-commit ke Git (seperti password database, JWT secret, dll).

### Buat file `.env`

```bash
cp .env.example .env
```

### Edit file `.env`

Buka file `.env` dan sesuaikan nilainya:

```env
NODE_ENV=development
PORT=3000

# Ganti "whoami_usernamemu" dengan hasil perintah: whoami
DATABASE_URL=postgresql://whoami_usernamemu@localhost:5432/cashiermu

# Generate string acak panjang untuk keamanan JWT
# Jalankan perintah ini di terminal untuk mendapatkan nilainya:
# node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
JWT_ACCESS_SECRET=isi_dengan_string_acak_panjang_minimal_32_karakter
JWT_REFRESH_SECRET=isi_dengan_string_acak_panjang_yang_berbeda

JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

FRONTEND_ORIGIN=http://localhost:8081
MAX_LOGIN_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=5
```

### Generate JWT Secret

Jalankan perintah ini dua kali (untuk ACCESS dan REFRESH), copy hasilnya ke `.env`:

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
```

---

## 6. Setup Database

### Buat database `cashiermu`

```bash
psql postgres -c "CREATE DATABASE cashiermu;"
```

### Jalankan migrasi

Migrasi = perintah untuk membuat semua tabel di database berdasarkan `prisma/schema.prisma`. Analoginya seperti "deploy struktur spreadsheet" ke database.

```bash
npx prisma migrate dev --name init
```

Output yang diharapkan:
```
✔ Generated Prisma Client
✔ Applied 1 migration
```

### Isi data awal (seed)

Seed = mengisi database dengan data dummy untuk development (user, produk, cabang, dll).

```bash
npm run db:seed
```

Output yang diharapkan:
```
🌱 Seeding database...
✅ Seed complete!

👤 Login credentials:
   Owner  → email: budi@cashiermu.com    PIN: 123456
   Kasir1 → email: siti@cashiermu.com    PIN: 111111
   Kasir2 → email: ahmad@cashiermu.com   PIN: 222222
```

### Verifikasi di pgAdmin

Buka pgAdmin → **CashierMu Local** → **Databases** → **cashiermu** → **Schemas** → **Tables**

Harusnya terlihat tabel-tabel: `User`, `Product`, `Transaction`, dll.

---

## 7. Jalankan Server

```bash
npm run dev
```

Output yang diharapkan:
```
info: CashierMu API running on port 3000 in development mode
```

Server sekarang berjalan di `http://localhost:3000`.

> Server akan otomatis restart setiap kali kamu menyimpan perubahan kode (hot reload via nodemon).

---

## 8. Test API

### Cara 1 — curl (via Terminal)

**Cek server hidup:**
```bash
curl http://localhost:3000/health
# Output: {"status":"ok","timestamp":"..."}
```

**Login:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"credential":"budi@cashiermu.com","pin":"123456"}'
```

Output: kamu akan mendapatkan `accessToken` dan `refreshToken`.

**Akses endpoint yang butuh login** (gunakan accessToken dari login):
```bash
curl http://localhost:3000/api/v1/store \
  -H "Authorization: Bearer PASTE_ACCESS_TOKEN_DISINI"
```

### Cara 2 — Postman (Rekomendasi, lebih nyaman)

1. Download **Postman** di [postman.com](https://www.postman.com/) (gratis)
2. Buat request baru → `POST` → `http://localhost:3000/api/v1/auth/login`
3. Tab **Body** → **raw** → **JSON** → isi:
   ```json
   {
     "credential": "budi@cashiermu.com",
     "pin": "123456"
   }
   ```
4. Klik **Send** → copy `accessToken` dari response
5. Untuk endpoint lain, tambahkan di tab **Authorization** → **Bearer Token** → paste token

### Cara 3 — Prisma Studio (lihat data visual)

```bash
npx prisma studio
```

Buka `http://localhost:5555` — bisa lihat semua tabel dan data langsung dari browser.

---

## 9. Integrasi dengan React Native

Setelah server berjalan, ganti semua data dummy di aplikasi React Native dengan API call ke server ini.

### Base URL

| Environment | URL |
|-------------|-----|
| Development (emulator) | `http://localhost:3000` |
| Development (device fisik) | `http://IP_MAC_KAMU:3000` |

> Cek IP Mac kamu: **System Settings** → **Wi-Fi** → **Details** → lihat IP Address. Pastikan HP dan Mac terhubung ke Wi-Fi yang sama.

### Urutan Integrasi (sesuai `BACKEND_PROMPT.md`)

Ganti dummy data di Zustand store satu per satu, mulai dari:

1. **Login** → `POST /api/v1/auth/login` — ganti `useAppStore.login()`
2. **Store profile** → `GET /api/v1/store` — ganti `DUMMY_STORE_PROFILE`
3. **Branches** → `GET /api/v1/branches` — ganti `DUMMY_BRANCHES`
4. **Categories** → `GET /api/v1/categories` — ganti `DUMMY_CATEGORIES`
5. **Products** → `GET /api/v1/products` — ganti `DUMMY_PRODUCTS`
6. **Shift** → `POST /api/v1/shifts/open` + `GET /api/v1/shifts/current`
7. **Transaksi** → `POST /api/v1/transactions`
8. **Riwayat transaksi** → `GET /api/v1/transactions`
9. **Void transaksi** → `POST /api/v1/transactions/:id/void`
10. **Laporan** → `GET /api/v1/reports/chart` + `/summary`
11. **Karyawan** → `GET /api/v1/users` + `POST /api/v1/users`

### Contoh API call dari React Native (Axios)

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
});

// Login
const response = await api.post('/auth/login', {
  credential: 'budi@cashiermu.com',
  pin: '123456',
});
const { accessToken, user } = response.data;

// Simpan token (gunakan expo-secure-store, JANGAN AsyncStorage)
await SecureStore.setItemAsync('accessToken', accessToken);

// Request dengan token
api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
const products = await api.get('/products');
```

---

## 10. Perintah Sehari-hari

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Jalankan server (development) |
| `npm run build` | Build untuk production |
| `npx prisma studio` | Buka UI visual database |
| `npx prisma migrate dev --name nama` | Buat migrasi baru setelah ubah schema |
| `npm run db:seed` | Reset dan isi ulang data dummy |
| `npx prisma generate` | Regenerate Prisma Client setelah ubah schema |

---

## 11. Struktur Project

```
server-cashiermu/
├── prisma/
│   ├── schema.prisma      # Definisi semua tabel database
│   └── seed.ts            # Script isi data dummy
├── src/
│   ├── config/
│   │   ├── env.ts         # Baca variabel dari .env
│   │   └── database.ts    # Koneksi ke PostgreSQL via Prisma
│   ├── middleware/
│   │   ├── authenticate.ts  # Verifikasi JWT token
│   │   ├── requireRole.ts   # Cek role (owner/cashier)
│   │   ├── validate.ts      # Validasi request body (Zod)
│   │   └── errorHandler.ts  # Handle error global
│   ├── modules/           # Setiap fitur punya folder sendiri
│   │   ├── auth/          # Login, logout, refresh token
│   │   ├── store/         # Profil toko
│   │   ├── users/         # Manajemen karyawan
│   │   ├── branches/      # Manajemen cabang
│   │   ├── categories/    # Kategori produk
│   │   ├── products/      # Manajemen produk & stok
│   │   ├── shifts/        # Buka/tutup shift kasir
│   │   ├── transactions/  # Transaksi & void
│   │   ├── pending-bills/ # Tagihan pending (hold order)
│   │   └── reports/       # Laporan penjualan
│   ├── utils/
│   │   ├── invoice.ts     # Generate nomor invoice
│   │   ├── pagination.ts  # Helper pagination
│   │   └── logger.ts      # Logging (Winston)
│   └── app.ts             # Entry point server
├── .env                   # Konfigurasi rahasia (jangan di-commit!)
├── .env.example           # Template .env
├── package.json
└── tsconfig.json
```

---

## 12. Troubleshooting

### Error: `Can't reach database server`
Pastikan PostgreSQL berjalan:
```bash
brew services start postgresql@14
```

### Error: `relation does not exist`
Migrasi belum dijalankan:
```bash
npx prisma migrate dev --name init
```

### Error: `JWT_ACCESS_SECRET is required`
File `.env` belum dibuat atau JWT secret masih placeholder. Pastikan sudah mengikuti [Langkah 5](#5-setup-environment-variables).

### Error: `Port 3000 already in use`
Ada proses lain yang pakai port 3000:
```bash
# Cari proses yang pakai port 3000
lsof -i :3000

# Kill prosesnya (ganti PID dengan angka dari output di atas)
kill -9 PID
```

### Setelah ubah `schema.prisma`, tabel tidak berubah
Jalankan migrasi baru:
```bash
npx prisma migrate dev --name deskripsi_perubahan
```
