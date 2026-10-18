# Panduan belajar: server dan infrastruktur CashierMu

Dokumen ini adalah rekap dari awal sampai akhir tentang **kebutuhan server CashierMu**: mengapa kita memilih server ini,
bagaimana semuanya tersusun, apa arti setiap istilah, dan bagaimana mengoperasikannya. Ditulis sebagai bahan belajar untuk
seorang frontend engineer yang sedang membangun SaaS pertamanya, jadi hampir setiap istilah dijelaskan dari dasar.

Panduan langkah demi langkah dengan perintah lengkap ada di [Deploying to a VPS](15-deployment.md). Dokumen ini menjelaskan
**mengapa** dan **apa artinya**; dokumen itu menjelaskan **bagaimana**.

Isi dokumen:

1. Gambaran besar
2. Apa yang dibutuhkan backend untuk berjalan
3. Mengapa bukan shared hosting
4. Memilih server: opsi, harga, dan keputusan
5. Spesifikasi server kita
6. Arsitektur lengkap dan perjalanan satu permintaan
7. Komponen satu per satu
8. Urutan setup dari nol
9. Operasional sehari-hari
10. Keamanan: lapisan pertahanan
11. Backup dan pemulihan
12. Pemantauan
13. Biaya bulanan
14. Masalah yang kita temui dan pelajarannya
15. Daftar periksa: sudah dan belum
16. Glosarium dan singkatan
17. Bahan bacaan lanjutan dan latihan

---

## 1. Gambaran besar

CashierMu terdiri dari empat bagian yang berdiri sendiri-sendiri:

| Bagian | Isinya | Tempatnya |
| ------ | ------ | --------- |
| **Aplikasi** | Aplikasi kasir Android (Expo / React Native) | HP kasir, didistribusikan lewat Google Play |
| **Landing page** | Situs promosi, halaman privasi dan syarat (Astro) | Hosting Jetorbit, alamat `cashiermu.com` |
| **Backend (API)** | Otak sistem: akun, produk, transaksi, laporan, sinkronisasi offline | Server (VPS) Biznet, alamat `api.cashiermu.com` |
| **Database** | Semua data toko: produk, transaksi, pengguna | PostgreSQL di server yang sama |

Aplikasi tidak menyimpan data utama di HP. Ia bicara ke API lewat internet; API menyimpan ke database. HP hanya menyimpan
catatan sementara (antrean transaksi offline, salinan katalog) supaya tetap bisa jualan saat internet putus.

Alasan kita butuh server sendiri: aplikasi kasir untuk banyak toko membutuhkan **satu tempat bersama** yang menjaga data setiap
toko tetap terpisah, menghitung harga dengan benar, dan menyimpan riwayat yang aman. Ini yang disebut **SaaS** (software as a service).

---

## 2. Apa yang dibutuhkan backend untuk berjalan

Backend kita adalah program yang harus **menyala terus** dan membutuhkan:

| Kebutuhan | Versi kita | Untuk apa |
| --------- | ---------- | --------- |
| Node.js | 20 | Menjalankan kode API (TypeScript yang sudah dikompilasi) |
| Express | 4 | Kerangka web: menerima permintaan, memanggil logika |
| Prisma | 5 | Penghubung ke database (ORM) dan pengelola migrasi |
| PostgreSQL | 16 | Database tempat semua data disimpan |
| HTTPS | sertifikat Let's Encrypt | Mengenkripsi lalu lintas (PIN dan token tidak boleh terbaca orang) |
| Rahasia | JWT secret, password database, token metrik | Menandatangani login dan melindungi akses |

Tiga hal ini menentukan jenis server yang cocok: program yang menyala terus, database sungguhan, dan HTTPS. Itulah yang
tidak bisa diberikan shared hosting (bagian berikut).

---

## 3. Mengapa bukan shared hosting

Kamu sudah punya hosting **Jetorbit Pluto** (shared hosting, 300 MB). Itu bagus, tetapi untuk hal lain.

**Shared hosting** = satu server besar yang dipakai ratusan situs sekaligus. Penyedia mengatur semuanya; kamu hanya
mengunggah file. Cocok untuk situs statis atau PHP biasa.

| | Shared hosting (Pluto) | VPS |
| - | ---------------------- | --- |
| Kamu dapat | Folder untuk file situs | Satu komputer virtual utuh |
| Program yang menyala terus (API) | Tidak bisa | Bisa |
| Database PostgreSQL | Umumnya hanya MySQL/MariaDB | Pasang apa saja |
| Docker | Tidak | Bisa |
| Akses root/SSH penuh | Tidak (atau terbatas) | Ya |
| Penyedia mengurus sistem | Ya | Tidak (kamu yang urus) |
| Harga | Sangat murah | Lebih mahal |

Kesimpulan: **landing page tetap di Pluto** (file statis, `cashiermu.com`), **backend butuh VPS** (`api.cashiermu.com`).
Satu domain, dua subdomain, dua tempat berbeda.

---

## 4. Memilih server: opsi, harga, dan keputusan

### 4.1 Jenis tempat menjalankan backend

| Pilihan | Penjelasan | Kelebihan | Kekurangan |
| ------- | ---------- | --------- | ---------- |
| **VPS** (pilihan kita) | Menyewa komputer virtual kosong | Murah dan tetap, belajar banyak, bisa pindah mudah | Kamu yang mengurus keamanan, backup, update |
| **PaaS** (Railway, Render, Fly.io) | Hubungkan GitHub, platform menjalankan | Paling mudah dimulai | Biaya dolar yang naik seiring pakai, ketergantungan pada vendor |
| **Server sendiri di rumah/kantor** | Mini PC yang menyala 24 jam | Murah di awal | Listrik/internet mati, IP berubah atau tertutup CGNAT, keamanan jaringan rumah, tidak cocok untuk produksi |
| **Cloud besar** (AWS, GCP, Azure) | Layanan sangat lengkap | Skala besar | Rumit dan biaya sulit diprediksi untuk pemula |

Kita memilih **VPS** karena biayanya tetap dan murah, kamu belajar dasar yang dipakai di mana-mana (Linux, Docker, DNS),
dan kit deploy kita (Docker Compose) bisa dipindahkan ke penyedia lain kapan saja.

### 4.2 Opsi yang kita bandingkan (harga per bulan, dari daftar saat kita menelitinya)

Harga bisa berubah; cek ulang di situs penyedia.

| Penyedia dan paket | vCPU | RAM | Disk | Harga | Catatan |
| ------------------ | ---- | --- | ---- | ----- | ------- |
| Jetorbit Cloud 1 | 1 | 2 GB | 25 GB NVMe | Rp 99 rb | KVM dan root tercantum |
| Jetorbit Cloud 2 | 1 | 4 GB | 50 GB NVMe | Rp 120 rb | KVM dan root tercantum |
| Jetorbit Cloud 3x | 2 | 4 GB | 60 GB | Rp 180 rb | |
| Jetorbit Cloud Classic 1 | 2 | 4 GB | 80 GB SSD | Rp 109 rb | **Ditagih tahunan**, VPS tidak bisa refund |
| Biznet NEO Lite SS 2.1 | 1 | 2 GB | 60 GB | Rp 80 rb | |
| Biznet NEO Lite SS 2.2 | 2 | 2 GB | 60 GB | Rp 109 rb | |
| **Biznet NEO Lite MS 4.2** | **2** | **4 GB** | **60 GB** | **Rp 139 rb** | **Pilihan kita** (bulanan) |
| Biznet NEO Lite MS 4.4 | 4 | 4 GB | 60 GB | Rp 179 rb | |

Harga di atas belum termasuk PPN (pajak 11%). MS 4.2 yang kita beli: Rp 139.000 + PPN = **Rp 154.290 per bulan**.

### 4.3 Mengapa MS 4.2

1. **RAM 4 GB adalah titik aman.** Stack kita memakai sekitar 1 GB saat berjalan, tetapi membangun image Docker saat
   deploy bisa sementara memakai 1,5 GB atau lebih. Dengan 2 GB, kita butuh swap dan tetap sempit.
2. **2 vCPU** memberi ruang saat banyak toko login (bcrypt menghitung hash PIN, memakai CPU) atau membuka laporan bersamaan.
3. **Tagihan bulanan, tanpa kontrak.** Untuk produk yang baru berjalan, tahunan dan tanpa refund berisiko.
4. **60 GB disk** lebih dari cukup: sistem sekitar 6 GB, image Docker sekitar 2 GB, data penjualan kecil.
5. **Lokasi West Java (dekat Jakarta)** memberi latensi rendah dari Indonesia.
6. Bisa dinaikkan spesifikasinya nanti tanpa membuat server baru.

### 4.4 Mengapa Ubuntu 24.04 LTS

- **LTS (Long Term Support)** mendapat pembaruan keamanan sekitar 5 tahun. Rilis non-LTS hanya sekitar 9 bulan, sehingga
  harus upgrade terus. Server produksi butuh stabil.
- Ubuntu adalah yang paling banyak dipakai; hampir semua tutorial dan jawaban di internet memakainya.
- Aturannya: rilis April di tahun genap (22.04, 24.04, 26.04) adalah LTS. Kita pilih 24.04 yang sudah matang;
  26.04 juga LTS tetapi baru, dan alat pihak ketiga kadang terlambat mendukung.
- Aplikasi kita berjalan **di dalam kontainer**, jadi versi Ubuntu di server hampir tidak mempengaruhi aplikasi.

### 4.5 Yang harus dipastikan sebelum membeli VPS

| Pertanyaan | Mengapa penting |
| ---------- | --------------- |
| Virtualisasinya **KVM**? | Docker butuh KVM. Beberapa paket murah memakai OpenVZ/LXC yang tidak cocok. |
| Ada akses **root** penuh? | Untuk memasang Docker dan mengatur server. |
| Penagihan bulanan atau tahunan, ada **refund**? | Hindari terkunci pada server yang salah. |
| **IPv4 publik** termasuk? | Tanpa IP publik, server tidak bisa dijangkau. |
| Pilihan OS **Ubuntu LTS**? | Sesuai panduan kita. |
| Harga sudah termasuk **PPN**? | Hindari kejutan di tagihan. |
| Bisa **upgrade** paket? | Untuk tumbuh tanpa pindah server. |

Cara membuktikan setelah beli: `systemd-detect-virt` harus menjawab `kvm`, dan `docker run hello-world` harus berhasil.
Kita sudah memverifikasi keduanya di server kita.

---

## 5. Spesifikasi server kita

| Hal | Nilai |
| --- | ----- |
| Penyedia dan paket | Biznet Gio, NEO Lite **MS 4.2** |
| Nama layanan | `cashiermu-prod` |
| Wilayah | West Java |
| CPU | 2 vCPU |
| RAM | 4 GB (sistem melaporkan sekitar 3,8 GiB yang bisa dipakai) |
| Disk | 60 GB SSD (sekitar 58 GB terlihat, 55 GB kosong saat awal) |
| Sistem operasi | Ubuntu 24.04.4 LTS |
| Virtualisasi | KVM (terverifikasi dengan `systemd-detect-virt`) |
| IP | 1 alamat IPv4 publik |
| Pengguna | `deploy` (anggota grup `sudo`), login hanya dengan kunci SSH |
| Alamat | `api.cashiermu.com` (record A di DNS Jetorbit) |
| Biaya | Rp 139.000 + PPN 11% = Rp 154.290 per bulan |

Perkiraan pemakaian memori saat berjalan normal:

| Komponen | Kira-kira |
| -------- | --------- |
| Sistem Ubuntu | 300 MB |
| Docker daemon | 100 MB |
| PostgreSQL | 100 sampai 300 MB (naik seiring data dan koneksi) |
| API (Node.js) | 150 sampai 250 MB |
| Caddy | 20 sampai 40 MB |
| **Total** | sekitar 0,8 sampai 1 GB |

Sisa sekitar 3 GB menjadi ruang aman, termasuk saat membangun image saat deploy.

---

## 6. Arsitektur lengkap dan perjalanan satu permintaan

### 6.1 Diagram

```
 [HP kasir: aplikasi CashierMu]      [Browser pelanggan]        [Pengunjung situs]
        |  HTTPS                           |  HTTPS                    |  HTTPS
        |  api.cashiermu.com               |  api.cashiermu.com/r/...  |  cashiermu.com
        v                                  v                           v
 +------------------------------------------------+      +---------------------------+
 |  VPS Biznet (Ubuntu 24.04, 2 vCPU, 4 GB)       |      | Hosting Jetorbit Pluto    |
 |                                                |      | (shared hosting)          |
 |  Firewall: hanya port 22, 80, 443              |      |  Landing page statis      |
 |    |                                           |      |  (Astro: HTML, CSS, JS)   |
 |    v                                           |      +---------------------------+
 |  +------------- Docker Compose -------------+  |
 |  |  Caddy  --->  API (Node.js)  --->  PostgreSQL |   Layanan luar:
 |  |  HTTPS        Express + Prisma      data      |   - Cloudinary (foto produk)
 |  +-------------------------------------------+  |   - Grafana Cloud (dashboard, alert)
 |   Alloy (kirim log dan metrik)    Skrip backup  |   - Penyimpanan backup di luar server
 +------------------------------------------------+
```

### 6.2 Perjalanan satu permintaan: kasir menekan "Bayar"

1. **Aplikasi** (di HP) mengirim permintaan HTTPS ke `https://api.cashiermu.com/api/v1/transactions`.
2. **DNS** menerjemahkan nama `api.cashiermu.com` menjadi alamat IP server (record A).
3. Permintaan tiba di server melewati **firewall** (hanya port 22, 80, 443 yang terbuka) dan sampai ke port 443.
4. **Caddy** menerimanya, membuka enkripsi HTTPS dengan sertifikatnya, lalu meneruskannya ke API lewat jaringan privat Docker.
5. **API** memeriksa token login, memvalidasi isi permintaan, **menghitung ulang harga di server** (tidak percaya angka dari HP),
   dan menyimpan transaksi di **PostgreSQL** dalam satu transaksi database.
6. API membalas, jawabannya kembali lewat Caddy ke HP.
7. Jika internet putus di langkah 1, aplikasi **menyimpan transaksi di HP** dan mengirimnya otomatis nanti dengan kunci
   idempotensi yang sama, sehingga tidak pernah tercatat ganda.

### 6.3 Mengapa memakai alamat berbeda untuk landing page dan API

- `cashiermu.com` mengarah ke hosting Jetorbit (file statis).
- `api.cashiermu.com` mengarah ke IP VPS. Ini hanya satu record DNS tambahan; **tidak perlu membeli domain baru**.
- Memisahkan keduanya berarti landing page tetap hidup walau server API sedang diperbarui, dan sebaliknya.

---

## 7. Komponen satu per satu

### 7.1 Linux, pengguna, dan sudo

- **Linux** adalah sistem operasi server. Kamu mengendalikannya lewat teks (terminal), bukan jendela.
- **root** adalah pengguna dengan kuasa penuh. Berbahaya dipakai sehari-hari, jadi kita membuat pengguna biasa **`deploy`**.
- **sudo** memberi `deploy` kuasa root untuk satu perintah saat dibutuhkan (`sudo apt update`).
- **apt** adalah pengelola paket Ubuntu: `apt update` (ambil daftar terbaru), `apt upgrade` (pasang pembaruan), `apt install` (pasang program).
- **systemd** menjalankan layanan latar belakang dan memulainya otomatis saat server hidup (`systemctl restart ssh`).
- **cron** menjalankan tugas terjadwal (kita pakai untuk backup malam).
- Jam server biasanya **UTC** (waktu universal). WIB = UTC + 7. Karena itu backup jam 20.00 UTC berjalan jam 03.00 WIB.
  Cek dengan `timedatectl`.

### 7.2 SSH: cara masuk ke server

- **SSH (Secure Shell)** adalah cara masuk ke terminal server dari jauh, terenkripsi.
- Memakai **sepasang kunci**: **kunci privat** (di Mac kamu, file `cashiermu_vps`, tidak boleh dibagikan) dan **kunci publik**
  (file `.pub`, dipasang di server). Server mengenali kuncimu tanpa password.
- Kita menonaktifkan **login password** dan **login root** (`/etc/ssh/sshd_config.d/00-hardening.conf`). Siapa pun yang
  menebak password tidak punya jalan masuk.
- **fail2ban** memblokir alamat IP yang berkali-kali gagal login SSH.
- **Deploy key**: kunci SSH terpisah **di server** (`cashiermu_deploy`), didaftarkan di GitHub sebagai kunci **baca saja**
  untuk repo backend. Fungsinya: server boleh mengambil kode, tetapi tidak bisa mengubahnya.
  Kunci ini berbeda dari kunci login (`cashiermu_vps` dari Mac ke server).

### 7.3 Firewall: dua lapis

1. **Security Group** di panel Biznet (di luar server): hanya mengizinkan port 22, 80, 443.
2. **UFW** di dalam server (Uncomplicated Firewall): aturan yang sama sebagai cadangan.

Port yang dipakai: **22** (SSH, untuk kamu), **80** (HTTP, Caddy memakainya untuk mengambil sertifikat dan mengalihkan ke HTTPS),
**443** (HTTPS, lalu lintas aplikasi). Selain itu tertutup, termasuk port database (5432).

### 7.4 Docker dan Docker Compose

- **Docker** menjalankan program di dalam **kontainer**: kotak terisolasi yang berisi program dan semua yang dibutuhkannya.
  Hasilnya sama di Mac, di server, di mana pun.
- **Image** = cetakan (resep + isi) yang dibangun dari `Dockerfile`. **Kontainer** = image yang sedang berjalan.
- **Volume** = penyimpanan yang bertahan walau kontainer dihapus. Penting: data database ada di volume `db-data`,
  sertifikat HTTPS di `caddy-data`, log di `api-logs`.
- **Jaringan (network)** = jaringan privat antar kontainer. Kontainer saling bicara lewat nama (`db`, `api`).
- **Docker Compose** menjalankan beberapa kontainer sekaligus dari satu berkas, `deploy/docker-compose.prod.yml`.
- `restart: unless-stopped` membuat kontainer hidup lagi sendiri setelah crash atau reboot server (sudah kita uji).
- **Healthcheck**: Docker memeriksa `GET /health` berkala; status `healthy` berarti API menjawab.

Tiga kontainer kita:

| Kontainer | Image | Tugas | Port ke luar |
| --------- | ----- | ----- | ------------ |
| `caddy` | `caddy:2-alpine` | Pintu depan, HTTPS | 80, 443 |
| `api` | image buatan kita (`Dockerfile`) | Logika aplikasi | tidak ada (hanya jaringan privat) |
| `db` | `postgres:16-alpine` | Database | tidak ada (hanya jaringan privat) |

Dockerfile kita bertahap (**multi-stage**): tahap *build* mengompilasi TypeScript, tahap *runtime* hanya membawa yang dibutuhkan
untuk menjalankan, dan berjalan sebagai pengguna biasa (`node`), bukan root.

### 7.5 Caddy: pintu depan (reverse proxy)

- **Web server** menerima permintaan web. **Reverse proxy** berdiri di depan program lain dan meneruskan permintaan ke sana.
- Caddy mengurus **HTTPS otomatis**: mengambil sertifikat gratis dari **Let's Encrypt** dan memperbaruinya sendiri
  (sertifikat berlaku 90 hari). Syaratnya: record DNS menunjuk ke server dan port 80 serta 443 terbuka.
- Menyembunyikan `/metrics` dari internet (dijawab 404), mengompres jawaban, dan menambahkan header keamanan (**HSTS**
  memaksa browser selalu memakai HTTPS).
- Konfigurasinya satu berkas pendek: `deploy/Caddyfile`.
- Alternatifnya Nginx; fungsinya mirip, tetapi HTTPS otomatis butuh alat tambahan.

### 7.6 API: Node.js, Express, Prisma

- **Node.js** menjalankan JavaScript di server. **Express** adalah kerangka web di atasnya.
- **Prisma** adalah **ORM** (Object-Relational Mapper): kamu menulis kode TypeScript, Prisma membuat SQL ke database.
- **Migrasi** = skrip berurutan yang membuat dan mengubah tabel (folder `prisma/migrations`). Setiap rilis, kita jalankan
  `prisma migrate deploy` supaya database mengikuti kode.
- **Konfigurasi lewat environment variable** di `deploy/.env` (tidak masuk Git): password database, rahasia JWT, alamat publik, dan lain-lain.
- Server **menolak start** di produksi bila rahasia lemah atau contoh; ini sengaja agar salah konfigurasi ketahuan.
- **Request ID**: setiap respons membawa `X-Request-Id`, supaya masalah bisa dicari di log.
- **Idempotency key**: kunci unik per transaksi supaya pengiriman ulang (misalnya setelah internet putus) tidak membuat transaksi ganda.

### 7.7 PostgreSQL: database

- Menyimpan semua data. Berjalan di kontainer `db`, datanya di volume `db-data`.
- **Tidak punya port terbuka ke luar**: hanya kontainer `api` di jaringan privat yang bisa mengaksesnya.
- Setiap toko dipisahkan di tingkat kode: semua query difilter dengan `storeId` dari token login.
- **Backup**: lihat bagian 11. Data di volume bukan backup; volume rusak berarti data hilang.

### 7.8 DNS: nama menjadi alamat

- **DNS (Domain Name System)** menerjemahkan nama (`api.cashiermu.com`) menjadi IP (`139.190.97.4`).
- **Record A** = nama menunjuk ke alamat IPv4. Kita punya satu: `api` → IP servermu.
- **Nameserver** = server yang memegang jawaban resmi. Untuk `cashiermu.com`, itu `ns1.jetorbit.net` dan `ns2.jetorbit.net`;
  perubahan dilakukan di **Zone Editor** cPanel Jetorbit.
- **TTL (Time To Live)** = berapa lama jawaban boleh disimpan (di-cache) oleh pihak lain. TTL 300 = 5 menit. TTL lama (misalnya
  14400 = 4 jam) membuat perubahan lambat tersebar. **Turunkan TTL sebelum pindah server.**
- **NXDOMAIN** = jawaban "nama ini tidak ada". Jawaban ini juga bisa tersimpan sebentar di cache, sehingga Mac-mu bisa
  masih gagal padahal DNS sudah benar.
- **Propagasi** = proses tersebarnya perubahan DNS ke seluruh dunia (menit sampai jam).
- Cek dari terminal: `dig +short api.cashiermu.com`, atau bertanya langsung ke sumbernya `dig +short api.cashiermu.com @ns1.jetorbit.net`.

### 7.9 Pemantauan: Alloy, Prometheus, Loki, Grafana

- **Metrik** = angka dari waktu ke waktu (jumlah permintaan, kecepatan, memori). API menyediakannya di `/metrics` (dilindungi token,
  disembunyikan Caddy dari internet).
- **Log** = catatan kejadian (satu baris JSON per permintaan, tanpa data pribadi).
- **Prometheus** menyimpan metrik, **Loki** menyimpan log, **Grafana** menampilkannya sebagai dashboard dan mengirim **alert**.
- **Alloy** adalah pengumpul: membaca log dan metrik di server lalu mengirimnya ke Grafana.
- Kita menyiapkan dashboard Backend dan Aplikasi serta 8 alert. Detail di [Monitoring](13-monitoring.md).

---

## 8. Urutan setup dari nol

Ini urutan yang sudah kita jalankan. Perintah lengkapnya ada di [Deploying to a VPS](15-deployment.md); di sini kamu belajar
**alasan setiap langkah**.

| # | Langkah | Mengapa |
| - | ------- | ------- |
| 1 | Pesan VPS (Ubuntu 24.04, MS 4.2, bulanan) dan pasang **kunci SSH** saat memesan | Server langsung hanya bisa dimasuki dengan kunci, tanpa password |
| 2 | Buat record DNS **A**: `api` → IP server | Nama harus menunjuk ke server sebelum Caddy bisa mengambil sertifikat |
| 3 | Login pertama sebagai `deploy`, cek `kvm`, RAM, disk | Memastikan server sesuai yang dibeli |
| 4 | `apt update && apt upgrade` | Pasang pembaruan keamanan terbaru |
| 5 | Kunci SSH: matikan login password dan login root | Hanya pemegang kunci yang bisa masuk |
| 6 | Uji login dari **terminal kedua** sebelum menutup yang pertama | Kalau salah, kamu tidak terkunci di luar |
| 7 | Firewall UFW (22, 80, 443), pasang **fail2ban** dan pembaruan otomatis | Mengurangi serangan dan menjaga server tetap mutakhir |
| 8 | Pasang **Docker** | Untuk menjalankan stack |
| 9 | Buat **deploy key** di server dan daftarkan ke GitHub (baca saja) | Server boleh mengambil kode privat |
| 10 | `git clone` repo backend | Mengambil Dockerfile dan berkas deploy |
| 11 | Buat `deploy/.env` dengan rahasia acak (`openssl rand -hex`) | Konfigurasi produksi, tidak masuk Git |
| 12 | `docker compose up -d --build` | Membangun dan menjalankan db, api, caddy |
| 13 | `prisma migrate deploy` | Membuat tabel di database baru |
| 14 | Cek `https://api.cashiermu.com/health` | Bukti semuanya jalan, sertifikat HTTPS terbit |
| 15 | `backup.sh`, `restore-test.sh`, jadwal cron | Data aman dan terbukti bisa dipulihkan |
| 16 | Uji reboot server | Semua menyala sendiri setelah restart |

---

## 9. Operasional sehari-hari

Semua perintah ini dijalankan di server, di folder `~/Server-CashierMu/deploy`.

| Kebutuhan | Perintah |
| --------- | -------- |
| Lihat status | `docker compose -f docker-compose.prod.yml ps` |
| Lihat log API langsung | `docker compose -f docker-compose.prod.yml logs -f api` |
| Mulai ulang API | `docker compose -f docker-compose.prod.yml restart api` |
| Cek pemakaian memori dan CPU | `docker stats --no-stream` |
| Cek disk | `df -h /` |
| Cek kesehatan dari luar | `curl -s https://api.cashiermu.com/health` |
| Backup manual | `./backup.sh` |

**Memperbarui ke versi baru:**

1. `cd ~/Server-CashierMu && git pull`
2. `cd deploy && ./backup.sh` (selalu backup dulu)
3. `docker compose -f docker-compose.prod.yml up -d --build`
4. `docker compose -f docker-compose.prod.yml run --rm -T api npx prisma migrate deploy`
5. Cek `/health`.

**Rollback:** kembali ke tag sebelumnya (`git checkout <tag>`) lalu bangun ulang. Kalau rilis baru menjalankan migrasi,
pulihkan database dari backup sebelum update, jangan hanya mengganti kode.

**Hal rutin yang perlu dilihat:** disk (`df -h`), memori (`free -h`), dan dashboard Grafana. Sertifikat HTTPS diperbarui
Caddy sendiri; pembaruan keamanan Ubuntu terpasang otomatis, tetapi sesekali server minta restart (`/var/run/reboot-required`).

---

## 10. Keamanan: lapisan pertahanan

Keamanan dibangun berlapis, supaya satu lapisan bocor tidak langsung berarti bobol.

| Lapisan | Yang kita lakukan |
| ------- | ----------------- |
| Jaringan | Security group dan UFW hanya membuka port 22, 80, 443; database dan API tidak punya port terbuka |
| Akses server | Login hanya dengan kunci SSH, tanpa password, tanpa root; fail2ban memblokir percobaan berulang |
| Kode di server | Deploy key baca saja; `.env` dengan izin 600 dan tidak ada di Git |
| Lalu lintas | HTTPS wajib (HTTP dialihkan), HSTS, header keamanan (helmet), `X-Powered-By` dihapus |
| Aplikasi | PIN disimpan sebagai hash bcrypt; pembatasan percobaan login per alamat dan per akun; token JWT berumur pendek; data setiap toko dipisah dengan `storeId`; server menghitung ulang harga |
| Konfigurasi | Server menolak start dengan rahasia lemah; `/metrics` dan `/docs` tidak terbuka di produksi |
| Pembaruan | Pembaruan keamanan Ubuntu otomatis (unattended-upgrades) |
| Pemulihan | Backup harian terbukti bisa dipulihkan |

**Risiko yang kita terima untuk awal** (dan perlu ditinjau lagi saat toko bertambah): token refresh belum dirotasi,
penguncian login tersimpan di memori satu proses, daftar data belum dipaginasi, antrean offline di HP tersimpan tanpa enkripsi,
dan crash di luar JavaScript belum dilaporkan. Daftar lengkap ada di [Production checklist](14-production-checklist.md).

**Rahasia**: jangan pernah menaruh `.env`, kunci privat SSH (`cashiermu_vps`, `cashiermu_deploy` tanpa `.pub`), password
konsol, atau token di chat, Git, atau tangkapan layar. Kalau terlanjur terlihat, **ganti** nilainya.

---

## 11. Backup dan pemulihan

**Aturan 3-2-1**: simpan **3** salinan data, di **2** jenis penyimpanan berbeda, dengan **1** salinan di luar lokasi.

| Salinan | Status kita |
| ------- | ----------- |
| Database asli (volume `db-data`) | Ada |
| Dump harian di server (`~/backups`, disimpan 14 hari) | Ada, jadwal cron 20.00 UTC (03.00 WIB) |
| Salinan di luar server (Cloudflare R2 lewat `rclone`, lihat [Off-site backup](17-r2-offsite-backup.md)) | Ada; aktifkan juga bucket lock |

Cara kerjanya:

- `backup.sh` menjalankan `pg_dump` **di dalam kontainer db** (tidak ada port database yang dibuka), mengompresnya dengan gzip,
  memeriksa file tidak rusak dan tidak kosong, lalu menghapus dump yang lebih dari 14 hari.
- `restore-test.sh` memulihkan dump terbaru ke database **sementara** bernama `restore_test`, menghitung toko, pengguna, dan
  transaksi, lalu menghapusnya. Database asli tidak tersentuh. Jalankan ini setelah backup pertama dan tiap beberapa minggu.
- Backup yang belum pernah diuji pulih hanyalah harapan.

Memulihkan kalau terjadi musibah (garis besar): hentikan API, `gunzip -c file.sql.gz | docker compose ... exec -T db psql -U cashiermu -d cashiermu`,
jalankan API lagi, lalu cek `/health`. Latih ini sekali dengan database percobaan supaya kamu tidak panik saat benar-benar butuh.

---

## 12. Pemantauan

| Alat | Fungsinya | Status |
| ---- | --------- | ------ |
| `/health` | Jawaban "hidup" dari API | Ada |
| Healthcheck Docker | Docker menandai API sehat atau tidak | Ada |
| Dashboard dan alert Grafana (API dan aplikasi) | Kecepatan, error, transaksi, sinkronisasi offline | File siap di `monitoring/`; **belum dipasang di server** |
| Pemantau uptime eksternal (UptimeRobot / Better Stack) | Memberi tahu kamu kalau server mati | **Belum** |
| Contact point alert di Grafana | Tempat alert dikirim (email, WhatsApp, Telegram) | **Belum** |

Pemantau uptime itu penting karena dari **luar** server: kalau server mati total, alat di dalam server ikut mati dan tidak
bisa memberi tahu siapa pun.

---

## 13. Biaya bulanan

| Item | Perkiraan | Catatan |
| ---- | --------- | ------- |
| VPS Biznet MS 4.2 | Rp 154.290 | Rp 139.000 + PPN 11% |
| Hosting Jetorbit Pluto | sekitar Rp 16 rb | Dari daftar harga yang kita lihat; cek tagihanmu |
| Domain `cashiermu.com` | biaya tahunan | Dibagi 12 untuk perkiraan bulanan |
| Grafana Cloud | gratis | Paket gratis cukup untuk awal |
| Cloudinary | gratis | Paket gratis untuk foto produk |
| Backup di luar server | gratis sampai kuota kecil | Cloudflare R2 / Backblaze B2 |
| Akun developer Google Play | biaya sekali bayar | Sudah kamu buat |
| EAS Build (Expo) | gratis dengan batas | Antrean build lebih lama di paket gratis |

Total rutin sekitar **Rp 175 sampai 200 ribu per bulan**. Angka ini perkiraan; ikuti tagihan aslimu.

---

## 14. Masalah yang kita temui dan pelajarannya

Masalah adalah bagian belajar. Ini yang terjadi dan cara mengenalinya lain kali.

| Masalah | Penyebab | Pelajaran |
| ------- | -------- | --------- |
| GitHub menolak push: "email privacy restrictions" | Email commit dianggap pribadi oleh akun yang sedang dipakai | Cek pengaturan email di GitHub atau pakai alamat noreply; periksa akun mana yang aktif |
| `Permission denied (publickey)` saat uji GitHub | Perintah dijalankan di **Mac**, bukan di server | Lihat prompt: `deploy@cashiermu-prod` itu server, `➜ ... git:(main)` itu Mac |
| `api.cashiermu.com` menunjuk ke IP hosting | cPanel membuat record otomatis lewat fitur **Dynamic DNS** | Satu nama punya satu record yang benar; periksa Zone Editor. Tautan pembaruan Dynamic DNS itu rahasia |
| DNS "tidak ditemukan" padahal sudah dibuat | Cache menyimpan jawaban NXDOMAIN lama dan TTL panjang | Tanya langsung ke nameserver; DNS publik via HTTPS; tunggu TTL; flush cache Mac |
| Perintah Expo gagal di Mac | Node 20.10 terlalu lama (butuh 20.19.4 atau lebih) | Pakai Node 22 LTS lewat `nvm` |
| Build Docker gagal (kode 127) | Skrip `prepare` (husky) tidak ada di build produksi | Hapus `prepare` di tahap runtime Docker |
| `docker compose run` menelan sisa perintah | Tanpa `-T`, ia membaca input terminal | Pakai `run --rm -T` dalam skrip |
| Pengaturan SSH tidak berlaku | Di Ubuntu 22.04 dan 24.04 berkas di `sshd_config.d/` dibaca lebih dulu dan menang | Taruh aturan kita di berkas yang diurutkan paling awal (`00-hardening.conf`) dan cek dengan `sshd -T` |
| Jadwal backup muncul dua kali | Perintah penambah cron dijalankan dua kali | Selalu cek `crontab -l` setelah mengubah |
| Skrip bash berperilaku aneh di Mac | Mac memakai **zsh**, server memakai **bash**; keduanya memecah variabel dengan cara berbeda | Uji skrip di shell yang sama dengan tempat berjalan |
| Paket tahunan Jetorbit | Penagihan tahunan dan VPS tanpa refund | Mulai bulanan; tanyakan kebijakan refund sebelum membayar |

---

## 15. Daftar periksa: sudah dan belum

**Sudah**

- [x] Server dipesan dan diverifikasi (KVM, Ubuntu 24.04, 4 GB RAM, 60 GB)
- [x] Login hanya dengan kunci SSH; root dan password dimatikan
- [x] Firewall, fail2ban, pembaruan keamanan otomatis
- [x] Docker terpasang; kode diambil dengan deploy key baca saja
- [x] `.env` produksi dengan rahasia acak
- [x] db, api, caddy berjalan; migrasi diterapkan
- [x] DNS `api.cashiermu.com` benar; sertifikat HTTPS dari Let's Encrypt terbit
- [x] `/metrics` dan `/docs` tersembunyi; HTTP dialihkan ke HTTPS
- [x] Backup, uji pemulihan, dan jadwal malam
- [x] Server menyala sendiri setelah reboot
- [x] Batas ukuran log Docker (3 file x 10 MB per kontainer), aktif setelah `docker compose up -d` berikutnya

**Belum (urutan prioritas)**

- [x] Salinan backup di luar server (`rclone` ke R2); bucket lock 14 hari belum tentu aktif, cek di dashboard
- [ ] Pemantau uptime eksternal
- [ ] Alloy dan Grafana Cloud di server, serta contact point alert
- [ ] Build aplikasi produksi dan uji di HP asli (pendaftaran toko, jual, offline, cetak)
- [ ] Persiapan Google Play (uji tertutup, URL privasi, formulir keamanan data)
- [ ] Penghapusan akun di dalam aplikasi (syarat Google Play)
- [ ] Merapikan izin foto aplikasi
- [ ] Jadwalkan latihan pemulihan rutin

---

## 16. Glosarium dan singkatan

### Infrastruktur dan jaringan

| Istilah | Arti |
| ------- | ---- |
| **VPS** (Virtual Private Server) | Komputer virtual yang disewa, kamu mengatur sendiri isinya |
| **vCPU** | Inti prosesor virtual |
| **RAM** | Memori kerja cepat tempat program berjalan |
| **SSD / NVMe** | Jenis disk cepat (NVMe lebih cepat dari SSD biasa) |
| **KVM** | Teknologi virtualisasi penuh; syarat Docker berjalan baik |
| **Hypervisor** | Perangkat lunak yang membagi satu mesin fisik menjadi beberapa VPS |
| **Shared hosting** | Satu server dipakai banyak situs; kamu hanya mengunggah file |
| **PaaS** (Platform as a Service) | Platform yang menjalankan kodemu tanpa kamu mengurus server |
| **IaaS** (Infrastructure as a Service) | Menyewa infrastruktur mentah, seperti VPS |
| **SaaS** (Software as a Service) | Perangkat lunak yang dijual sebagai layanan langganan; CashierMu adalah SaaS |
| **Data center** | Gedung berisi server dengan listrik dan internet cadangan |
| **IP** | Alamat angka sebuah perangkat di internet |
| **IPv4 / IPv6** | Dua versi alamat IP (IPv4 contoh `139.190.97.4`; IPv6 lebih panjang) |
| **CGNAT** | Penyedia internet membagi satu IP publik untuk banyak pelanggan; membuat server rumahan tidak bisa dijangkau |
| **Port** | "Pintu bernomor" di sebuah server: 22 SSH, 80 HTTP, 443 HTTPS, 5432 PostgreSQL |
| **Firewall** | Penjaga yang mengizinkan atau menolak lalu lintas menurut aturan |
| **Security Group** | Firewall di sisi penyedia cloud, di luar server |
| **UFW** | Firewall sederhana bawaan Ubuntu di dalam server |
| **Latensi** | Waktu tunda perjalanan data (semakin dekat server, semakin kecil) |
| **Bandwidth / transfer** | Jumlah data yang boleh lewat per bulan |
| **Uptime** | Persentase waktu server hidup dan melayani |
| **SLA** | Janji tingkat layanan dari penyedia (misalnya uptime 99,9%) |
| **OOM killer** | Mekanisme Linux yang mematikan program paksa saat memori habis |
| **Swap** | Ruang disk yang dipakai sebagai RAM cadangan |

### DNS dan web

| Istilah | Arti |
| ------- | ---- |
| **DNS** | Sistem yang menerjemahkan nama domain menjadi IP |
| **Domain / subdomain** | `cashiermu.com` adalah domain; `api.cashiermu.com` adalah subdomain |
| **Record A** | Nama menunjuk ke alamat IPv4 |
| **CNAME** | Nama menunjuk ke nama lain |
| **TXT record** | Catatan teks di DNS (dipakai untuk verifikasi, misalnya Google) |
| **Nameserver (NS)** | Server yang memegang data DNS resmi sebuah domain |
| **TTL** | Lama jawaban DNS boleh disimpan di cache |
| **NXDOMAIN** | Jawaban DNS "nama tidak ada" |
| **Propagasi** | Proses tersebarnya perubahan DNS |
| **Zone Editor** | Menu cPanel untuk mengubah record DNS |
| **HTTP / HTTPS** | Protokol web; HTTPS adalah versi terenkripsi |
| **SSL / TLS** | Teknologi enkripsi di balik HTTPS (TLS adalah penerus SSL) |
| **Sertifikat** | Berkas yang membuktikan identitas server untuk HTTPS |
| **Let's Encrypt** | Penerbit sertifikat HTTPS gratis |
| **HSTS** | Header yang memerintahkan browser selalu memakai HTTPS |
| **Reverse proxy** | Server di depan program lain yang meneruskan permintaan |
| **CORS** | Aturan browser tentang situs mana yang boleh memanggil API |
| **API** | Antarmuka program: cara aplikasi berbicara dengan server |
| **REST** | Gaya API memakai alamat dan metode HTTP (GET, POST, PATCH, DELETE) |
| **Endpoint** | Satu alamat API, misalnya `/api/v1/transactions` |
| **JSON** | Format data teks yang dipakai API |
| **Health check** | Alamat yang menjawab "saya hidup" (`/health`) |

### Linux dan server

| Istilah | Arti |
| ------- | ---- |
| **Linux / Ubuntu** | Sistem operasi server; Ubuntu adalah distribusinya |
| **LTS** | Long Term Support: rilis dengan dukungan keamanan jangka panjang |
| **Terminal / shell** | Jendela perintah teks (Mac memakai zsh, server memakai bash) |
| **SSH** | Cara masuk ke terminal server dari jauh secara terenkripsi |
| **Kunci privat / publik** | Pasangan kunci SSH; privat dirahasiakan, publik dipasang di server |
| **Deploy key** | Kunci SSH baca-saja untuk satu repo GitHub |
| **root** | Pengguna dengan kuasa penuh |
| **sudo** | Menjalankan satu perintah dengan kuasa root |
| **apt** | Pengelola paket Ubuntu |
| **systemd / systemctl** | Pengelola layanan latar belakang |
| **cron / crontab** | Penjadwal tugas berkala |
| **UTC / WIB** | Waktu universal / Waktu Indonesia Barat (UTC + 7) |
| **fail2ban** | Program yang memblokir IP yang berulang kali gagal login |
| **unattended-upgrades** | Pembaruan keamanan otomatis |
| **chmod 600** | Mengatur berkas hanya bisa dibaca dan ditulis pemiliknya |

### Docker dan aplikasi

| Istilah | Arti |
| ------- | ---- |
| **Docker** | Menjalankan program di kontainer terisolasi |
| **Image** | Cetakan yang menjadi dasar kontainer |
| **Kontainer** | Image yang sedang berjalan |
| **Dockerfile** | Resep membuat image |
| **Docker Compose** | Menjalankan beberapa kontainer dari satu berkas YAML |
| **Volume** | Penyimpanan yang bertahan walau kontainer dihapus |
| **Multi-stage build** | Dockerfile bertahap supaya image akhir kecil dan bersih |
| **YAML** | Format berkas konfigurasi (`docker-compose.prod.yml`) |
| **Environment variable** | Pengaturan yang dikirim ke program lewat lingkungan, bukan kode |
| **`.env`** | Berkas berisi environment variable (rahasia, tidak masuk Git) |
| **Node.js / Express** | Lingkungan JavaScript server / kerangka web |
| **ORM / Prisma** | Penerjemah kode ke SQL; Prisma adalah ORM kita |
| **Migrasi** | Skrip berurutan yang mengubah struktur database |
| **PostgreSQL** | Database relasional yang kita pakai |
| **SQL** | Bahasa untuk menanyakan dan mengubah database |
| **Transaksi database** | Sekumpulan perubahan yang berhasil semua atau batal semua |
| **bcrypt** | Cara menyimpan PIN sebagai hash yang tidak bisa dibalik |
| **Hash** | Sidik jari satu arah dari data |
| **JWT** | Token login yang ditandatangani server |
| **Idempotency key** | Kunci unik supaya permintaan yang diulang tidak diproses dua kali |
| **Rate limit** | Pembatasan jumlah permintaan per waktu |
| **Multi-tenant** | Banyak toko memakai sistem yang sama dengan data terpisah |
| **CI/CD** | Otomatisasi uji dan rilis (belum kita pakai; langkah berikutnya yang wajar) |

### Pemantauan, backup, dan rilis

| Istilah | Arti |
| ------- | ---- |
| **Metrik** | Angka dari waktu ke waktu (permintaan per detik, memori) |
| **Log** | Catatan kejadian |
| **Prometheus / Loki / Grafana / Alloy** | Penyimpan metrik / penyimpan log / dashboard / pengumpul |
| **Faro** | Format telemetri Grafana untuk aplikasi |
| **Alert** | Pemberitahuan otomatis saat sesuatu tidak normal |
| **p95** | Waktu respons yang 95% permintaan lebih cepat darinya |
| **Backup 3-2-1** | 3 salinan, 2 jenis penyimpanan, 1 di luar lokasi |
| **pg_dump** | Alat PostgreSQL untuk membuat salinan database |
| **rclone** | Alat menyalin file ke penyimpanan awan (R2, B2) |
| **SemVer** | Penomoran versi `MAJOR.MINOR.PATCH` |
| **Git / GitHub** | Pelacak perubahan kode / tempat menyimpannya |
| **Branch / merge / tag** | Cabang kerja / penggabungan / penanda versi rilis |
| **EAS** | Expo Application Services: membangun aplikasi di server Expo |
| **APK / AAB** | Berkas aplikasi Android: APK untuk dipasang langsung, AAB untuk diunggah ke Google Play |
| **Keystore** | Berkas kunci penandatangan aplikasi Android; hilang berarti tidak bisa memperbarui aplikasi yang sama |
| **PPN** | Pajak Pertambahan Nilai (11%) |

---

## 17. Bahan bacaan lanjutan dan latihan

**Dokumentasi resmi untuk dibaca berurutan**

1. Docker: `docs.docker.com` (Get started, lalu Compose)
2. Caddy: `caddyserver.com/docs` (Caddyfile concepts)
3. Ubuntu Server: `ubuntu.com/server/docs`
4. PostgreSQL: `postgresql.org/docs` (bagian Backup and Restore)
5. Prisma: `prisma.io/docs` (Migrate)
6. Let's Encrypt: `letsencrypt.org/docs` (How it works)
7. Grafana: `grafana.com/docs`

**Dokumen di repo ini yang melengkapi**

- [Architecture](03-architecture.md): bagaimana permintaan mengalir di dalam kode.
- [Deploying to a VPS](15-deployment.md): perintah lengkap.
- [Production checklist](14-production-checklist.md): daftar yang harus dipenuhi sebelum toko nyata memakai.
- [Monitoring](13-monitoring.md): dashboard dan alert Grafana.
- [Offline sales](12-offline-sales.md): bagaimana transaksi offline dikirim dengan aman.

**Pertanyaan untuk menguji pemahamanmu** (jawab sendiri dulu, baru cek dokumen):

1. Mengapa API tidak boleh membuka port 3000 ke internet? Siapa yang menjadi pintu depan?
2. Apa yang terjadi di langkah 2 sampai 5 saat kasir menekan "Bayar"?
3. Mengapa PIN disimpan sebagai hash dan bukan teks asli? Bisakah kamu melihat PIN pengguna di database?
4. Apa bedanya kunci login `cashiermu_vps` dengan deploy key `cashiermu_deploy`?
5. Mengapa kita menurunkan TTL DNS sebelum pindah server?
6. Apa risiko menyimpan backup hanya di server yang sama?
7. Mengapa kita menguji login dari terminal kedua sebelum menutup sesi SSH pertama?
8. Apa yang terjadi pada transaksi kalau server mati sepuluh menit, dan bagaimana transaksi itu tidak hilang atau ganda?

**Latihan praktik** (aman karena belum ada data toko asli):

1. Hentikan API lalu nyalakan lagi: `docker compose -f docker-compose.prod.yml stop api`, cek `curl`, lalu `start api`. Perhatikan kapan `/health` gagal.
2. Lihat log saat kamu membuka `/health` beberapa kali. Cari `requestId` dan `durationMs`.
3. Ubah jadwal backup jadi setiap menit sementara, lihat file bertambah di `~/backups`, lalu kembalikan.
4. Jalankan `./restore-test.sh` dan jelaskan apa yang dilakukan setiap barisnya.
5. Cari tahu: berapa lama lagi sertifikat HTTPS berlaku? (Petunjuk: `openssl s_client`, atau lihat di browser.)
6. Tulis ulang bagian 6.2 dengan kata-katamu sendiri tanpa melihat dokumen.
