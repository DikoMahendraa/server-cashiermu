# pgAdmin via SSH Tunnel

Cara mengakses database PostgreSQL production dari pgAdmin di laptop, tanpa membuka port database ke internet.

## Arsitektur

```
pgAdmin (laptop) ──5433──► SSH Tunnel ──► VPS :5433 ──► Docker cashiermu-db-1 :5432
```

PostgreSQL berjalan di dalam Docker container dan hanya bisa diakses lewat internal Docker network. SSH tunnel menjembatani laptop ke container tersebut secara aman.

---

## Persiapan (sekali saja)

### 1. Expose port database ke localhost VPS

Di `deploy/docker-compose.prod.yml`, service `db` perlu port binding ke localhost VPS (bukan ke internet):

```yaml
services:
  db:
    ports:
      - '127.0.0.1:5433:5432'  # localhost-only, tidak terbuka ke internet
```

> Port host `5433` dipakai karena `5432` sudah dipakai oleh PostgreSQL bawaan Ubuntu di VPS.

Apply perubahan di VPS:
```bash
cd ~/Server-CashierMu/deploy
git pull
docker compose -f docker-compose.prod.yml up -d db
```

Verifikasi port sudah listening:
```bash
ss -tlnp | grep 5433
```

### 2. Sinkronisasi password

Password PostgreSQL di dalam container harus sama dengan `POSTGRES_PASSWORD` di `deploy/.env`. Jalankan ini di VPS untuk menyamakan keduanya:

```bash
cd ~/Server-CashierMu/deploy

# Ambil password dari .env
PGPASS=$(grep '^POSTGRES_PASSWORD' .env | cut -d= -f2)

# Reset password di dalam container agar sesuai .env
docker exec cashiermu-db-1 psql -U cashiermu -c "ALTER USER cashiermu WITH PASSWORD '$PGPASS';"
```

> **Kenapa bisa tidak sinkron?** Container PostgreSQL hanya membaca `POSTGRES_PASSWORD` saat pertama kali diinisialisasi (saat volume `db-data` masih kosong). Kalau `.env` diubah setelah container pernah jalan, password di dalam database tidak ikut berubah — harus di-reset manual dengan `ALTER USER` seperti di atas.

---

## Cara pakai setiap kali mau buka pgAdmin

### Step 1 — Buka SSH tunnel di terminal lokal

```bash
ssh -L 5433:localhost:5433 deploy@<IP-VPS> -N -i ~/.ssh/cashiermu_vps
```

Biarkan terminal ini tetap terbuka selama pgAdmin dipakai. Kalau ditutup, koneksi pgAdmin akan putus.

### Step 2 — Koneksi di pgAdmin

Tambah server baru di pgAdmin dengan konfigurasi berikut:

**Tab General**
| Field | Value |
|-------|-------|
| Name | CashierMu Prod |

**Tab Connection**
| Field | Value |
|-------|-------|
| Host | `127.0.0.1` |
| Port | `5433` |
| Maintenance database | `cashiermu` |
| Username | `cashiermu` |
| Password | isi dari `POSTGRES_PASSWORD` di `deploy/.env` |

> Tab SSH Tunnel di pgAdmin **tidak perlu diisi** — tunnel sudah dibuka manual di Step 1.

---

## Masuk ke database via terminal (tanpa pgAdmin)

```bash
# Dari VPS langsung
docker exec -it cashiermu-db-1 psql -U cashiermu -d cashiermu

# Perintah berguna di dalam psql
\dt                          -- lihat semua tabel
\d "NamaTabel"               -- lihat struktur tabel
SELECT count(*) FROM "User"; -- hitung data
\q                           -- keluar
```

## Cek ukuran database

```sql
SELECT pg_size_pretty(pg_database_size('cashiermu'));
```

## Backup manual

```bash
docker exec cashiermu-db-1 pg_dump -U cashiermu cashiermu > backup-$(date +%Y%m%d).sql
```
