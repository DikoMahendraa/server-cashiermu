# 17. Backup di luar server dengan Cloudflare R2

Dump harian di server (lihat [Deploying to a VPS](15-deployment.md)) hanya melindungi dari salah hapus. Kalau VPS rusak,
akunnya dibekukan, atau server dibobol, dump itu ikut hilang. Dokumen ini menjelaskan salinan kedua di **Cloudflare R2**,
cara melindunginya dari penghapusan, dan cara memulihkan darinya. Istilah dasar backup ada di
[Server learning guide](16-server-learning-guide.md).

## Cara kerjanya

```
cron 03.00 WIB ─► backup.sh ─► pg_dump (di kontainer db) ─► ~/backups/cashiermu-<waktu>.sql.gz   (disimpan 14 hari)
                                                      └──► rclone copy ─► R2: cashiermu-backups   (dikunci 14 hari, dihapus 30 hari)
```

- `backup.sh` memakai `rclone copy`, **bukan** `sync`. Salinan di R2 tidak pernah dihapus oleh skrip, jadi menghapus dump lokal
  tidak ikut menghapus yang di R2.
- Nama file memuat waktu UTC, jadi tidak ada file yang tertimpa.
- Salinan ke R2 hanya berjalan kalau `RCLONE_REMOTE` terisi. Tanpa itu skrip mencetak `WARNING: RCLONE_REMOTE not set`.

## 1. Menyiapkan R2

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**, nama `cashiermu-backups`. Biarkan privat (default).
2. **Manage API Tokens** → **Create API token**:
   - Permission **Object Read & Write**
   - **Specify bucket**: hanya `cashiermu-backups`
3. Simpan **Access Key ID**, **Secret Access Key**, dan **endpoint** (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`) di password
   manager. Secret hanya ditampilkan sekali. Jangan taruh di Git, chat, atau tangkapan layar.

## 2. Menghubungkan server

Di server, sebagai user `deploy`:

```bash
sudo apt install -y rclone
rclone config            # n, name: r2, storage: s3, provider: Cloudflare, isi key dan endpoint, acl kosong
rclone config update r2 no_check_bucket true
```

`no_check_bucket` perlu karena token yang dibatasi ke satu bucket tidak boleh membuat bucket, dan rclone akan mencobanya.
Mode interaktif dipakai supaya secret tidak masuk riwayat perintah (`~/.bash_history`). Kuncinya tersimpan di
`~/.config/rclone/rclone.conf`; berkas itu berisi rahasia dan tidak boleh disalin ke mana pun.

Uji:

```bash
echo tes > /tmp/tes.txt && rclone copy /tmp/tes.txt r2:cashiermu-backups/ && rclone ls r2:cashiermu-backups
rclone delete r2:cashiermu-backups/tes.txt && rm /tmp/tes.txt
```

Lakukan uji ini **sebelum** mengaktifkan bucket lock (bagian 4), karena setelah itu file tes tidak bisa dihapus sampai
masa kuncinya habis.

## 3. Menjadwalkan

```bash
echo '0 20 * * * RCLONE_REMOTE=r2:cashiermu-backups /home/deploy/Server-CashierMu/deploy/backup.sh >> /home/deploy/backup.log 2>&1' | crontab -
crontab -l       # harus tepat satu baris
```

`0 20 * * *` dalam UTC sama dengan 03.00 WIB. Hari berikutnya: `tail -5 ~/backup.log` harus memuat `copied off-server`, dan
`rclone ls r2:cashiermu-backups` menampilkan file barunya.

## 4. Melindungi dari penghapusan

Token **Object Read & Write** bisa menulis, membaca, **dan menghapus** objek. R2 tidak punya token "hanya boleh menulis".
Artinya, kalau server dibobol, penyerang yang menemukan `rclone.conf` bisa menghapus semua backup. Pertahanannya adalah
**bucket lock**, yang mencegah objek dihapus atau ditimpa selama masa tertentu, siapa pun pemegang tokennya.

1. Dashboard → bucket `cashiermu-backups` → **Settings** → **Bucket lock rules** → **Add rule**.
2. Nama `retain-14d`, prefix kosong (seluruh bucket), retensi **14 hari**.
3. **Lifecycle rule** (Settings → Object lifecycle rules): hapus objek setelah **30 hari**, supaya bucket tidak membesar
   terus. Bucket lock didahulukan, jadi objek tidak terhapus sebelum 14 hari walau lifecycle-nya lebih pendek.
4. Uji bahwa kunci bekerja, dengan file yang **sudah ada** di bucket:

```bash
rclone delete r2:cashiermu-backups/cashiermu-<salah-satu-backup>.sql.gz
```

Perintah itu harus **gagal** (error akses ditolak). Kalau berhasil, kuncinya belum aktif; jangan anggap backup aman dulu.

Yang perlu diingat:

- Kunci menahan **semua** objek, termasuk file salah unggah, selama 14 hari. Karena itu uji dengan file tes dilakukan sebelum kunci.
- Bucket tidak bisa dikosongkan selama aturan kunci masih ada. Untuk menghapus bucket, hapus aturannya dulu.
- Kunci hanya melindungi dari token yang bocor. Siapa pun yang bisa masuk **dashboard Cloudflare** bisa menghapus aturan kunci,
  jadi aktifkan **2FA** di akun Cloudflare dan pakai password unik.
- Retensi 14 hari berarti serangan yang baru ketahuan setelah lebih dari 14 hari tetap bisa menghilangkan backup lama.
  Naikkan retensi kalau data toko sudah besar (biayanya kecil, dump hanya beberapa MB).

## 5. Memulihkan dari R2

Skenario terburuk: server hilang dan kamu mulai dari VPS baru.

1. Siapkan server baru sampai Docker berjalan, ikuti [Deploying to a VPS](15-deployment.md) sampai database kosong aktif.
2. Pasang rclone dan buat remote `r2` lagi. Untuk ini cukup token **Object Read only**; buat yang baru di dashboard.
3. Unduh dump terbaru:

```bash
rclone lsl r2:cashiermu-backups | sort -k2,3 | tail -3          # lihat yang terbaru
rclone copy r2:cashiermu-backups/cashiermu-<waktu>.sql.gz ~/backups/
```

4. Pulihkan (API dihentikan dulu supaya tidak ada tulisan baru):

```bash
cd ~/Server-CashierMu/deploy
docker compose -f docker-compose.prod.yml stop api
gunzip -c ~/backups/cashiermu-<waktu>.sql.gz | docker compose -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml up -d
curl -s https://api.cashiermu.com/health
```

5. Buka aplikasi, login, dan cek data terakhir (penjualan, stok).

**Latih ini sekali sebelum ada toko sungguhan**, di VPS percobaan atau lewat `restore-test.sh`. Backup yang belum pernah
dipulihkan hanyalah harapan. Sebulan sekali, unduh satu dump dari R2 dan jalankan uji pemulihan.

## 6. Rutinitas

| Kapan | Apa |
| ----- | --- |
| Tiap pagi (singkat) | `tail -3 ~/backup.log` atau lihat notifikasi uptime |
| Tiap bulan | Unduh satu dump dari R2, jalankan uji pemulihan |
| Tiap bulan | `rclone ls r2:cashiermu-backups` memuat dump hari ini; cek ukuran wajar |
| Saat mengganti server | Buat token R2 baru, **cabut token lama** di dashboard |
| Kalau `rclone.conf` atau server dicurigai bocor | Cabut token R2 saat itu juga dan buat yang baru |

## Masalah umum

| Gejala | Penyebab | Solusi |
| ------ | -------- | ------ |
| `AccessDenied` / `403` saat `rclone copy` | Token tidak mencakup bucket, atau `no_check_bucket` belum diset | Buat ulang token dengan bucket yang benar, jalankan `rclone config update r2 no_check_bucket true` |
| `NoSuchBucket` | Endpoint atau nama bucket salah | Cek `rclone config show r2` (jangan bagikan hasilnya, berisi kunci) dan nama bucket |
| `WARNING: RCLONE_REMOTE not set` | Cron tidak memuat variabelnya | Pastikan baris cron memuat `RCLONE_REMOTE=r2:cashiermu-backups` |
| `backup.log` tidak bertambah | Cron tidak berjalan atau ganda | `crontab -l`, harus satu baris |
| Tidak bisa menghapus file tes | Bucket lock aktif | Normal; tunggu masa retensi habis |
