# 18. Pemantauan produksi: UptimeRobot dan Grafana Cloud

Dua lapis yang saling melengkapi:

| Lapis | Menjawab | Berjalan di |
| ----- | -------- | ----------- |
| **UptimeRobot** | "Apakah server hidup?" | Luar server (kalau server mati total, ia tetap memberi tahu) |
| **Grafana Cloud + Alloy** | "Kenapa lambat atau error? Berapa transaksi hari ini?" | Alloy di server, dashboard di cloud |

Penjelasan dashboard dan alert-nya ada di [Monitoring (Grafana)](13-monitoring.md). Dokumen ini khusus menjalankannya di VPS.

## 1. UptimeRobot (sekitar 10 menit)

1. Daftar di uptimerobot.com (paket gratis, cek tiap 5 menit).
2. **Add New Monitor**, tipe **HTTP(s) - Keyword**:
   - URL `https://api.cashiermu.com/health`
   - Keyword `ok` (sesuaikan dengan isi jawaban `/health`: `curl -s https://api.cashiermu.com/health`), alert saat keyword **tidak ada**
   - Interval 5 menit
3. Tambahkan **alert contact** (email dulu). Uji dengan menghentikan API sebentar:
   `docker compose -f docker-compose.prod.yml stop api`, tunggu sampai ada notifikasi, lalu `start api`.
4. Opsional: monitor tipe HTTP(s) untuk `https://cashiermu.com` (landing) dan `https://docs.cashiermu.com`.

## 2. Menyiapkan Grafana Cloud

Ini langkah yang hanya bisa kamu lakukan di browser.

1. Daftar di grafana.com dan buat **stack** (pilih region terdekat, misalnya Singapore).
2. **Connections → Hosted Prometheus metrics**: catat **remote write URL** dan **username** (angka). Itu `GC_PROM_URL` dan `GC_PROM_USER`.
3. **Connections → Hosted logs**: catat **URL** dan **username**. Itu `GC_LOKI_URL` dan `GC_LOKI_USER`.
4. **Administration → Access policies → Create access policy**: scope `metrics:write` dan `logs:write`, lalu buat **token**.
   Itu `GC_API_KEY`. Token hanya tampil sekali; simpan di password manager.
5. Buat string acak untuk `FARO_API_KEY`: `openssl rand -hex 16`.

## 3. Menjalankan Alloy di server

1. DNS: buat record **A** `telemetry` → IP server (di Zone Editor, bukan Dynamic DNS), lalu cek dengan
   `dig +short telemetry.cashiermu.com @8.8.8.8`.
2. Di `~/Server-CashierMu/deploy/.env` isi nilai berikut (tanpa spasi di sekitar `=`). `METRICS_TOKEN` harus terisi, kalau tidak
   `/metrics` mati dan tidak ada metrik API:

```
METRICS_TOKEN=<openssl rand -hex 32>
GC_PROM_URL=...
GC_PROM_USER=...
GC_LOKI_URL=...
GC_LOKI_USER=...
GC_API_KEY=...
FARO_API_KEY=...
```

3. Terapkan (`--profile monitoring` menyalakan Alloy; tanpa itu Alloy tidak berjalan):

```bash
cd ~/Server-CashierMu && git pull && cd deploy
docker compose -f docker-compose.prod.yml --profile monitoring up -d --build
docker compose -f docker-compose.prod.yml --profile monitoring ps
docker compose -f docker-compose.prod.yml logs --tail 30 alloy
```

`alloy` harus berstatus `running` dan lognya tidak berisi error `401`/`403`/`connection refused`. Karena `METRICS_TOKEN` berubah,
API ikut dibuat ulang (beberapa detik tidak tersedia).

Catatan: setelah ini, selalu sertakan `--profile monitoring` pada `up -d` berikutnya. Tanpa itu Compose tidak mengurus Alloy.

4. Cek dari luar: `curl -si -X POST https://telemetry.cashiermu.com/collect -H 'Content-Type: application/json' -d '{}' | head -3`.
   Jawaban `401` (kunci kosong) atau `400` (isi kosong) berarti jalurnya hidup. `404` atau error TLS berarti DNS atau Caddy belum benar.

## 4. Dashboard dan alert

1. **Dashboards → New → Import**, unggah `monitoring/grafana/dashboards/*.json`. Pilih data source Prometheus dan Loki milikmu. File
   mengharapkan uid `prometheus` dan `loki`; kalau berbeda, ganti uid di data source atau di JSON.
2. Cek **Explore → Prometheus**, query `up{job="cashiermu-api"}`. Nilai `1` berarti metrik API masuk.
3. Alert: impor `monitoring/prometheus/rules.yml` sebagai alert rule, atau buat sendiri. Minimal:
   - API tidak menjawab (`up == 0` selama 5 menit)
   - Rasio error 5xx tinggi
   - Latensi p95 tinggi
   - Memori kontainer mendekati batas
4. **Alerting → Contact points → New**: email dulu, lalu bisa Telegram. Hubungkan lewat **Notification policy**. Uji dengan
   tombol **Test** pada contact point. **Alert tanpa contact point tidak akan memberi tahu siapa pun.**

## 5. Menyambungkan aplikasi

Aplikasi mengirim telemetri ke `https://telemetry.cashiermu.com/collect`. Di repo aplikasi (`eas.json`, bagian `env` tiap profile build):

```
EXPO_PUBLIC_TELEMETRY_URL=https://telemetry.cashiermu.com/collect
EXPO_PUBLIC_TELEMETRY_KEY=<nilai FARO_API_KEY yang sama>
```

Nilai ini ikut terbungkus dalam aplikasi, jadi bukan rahasia; ia hanya membatasi kiriman sembarangan. Karena variabel `EXPO_PUBLIC_*`
masuk saat build, aplikasi **harus dibuild ulang**. Telemetri tidak memuat nama atau nomor telepon pelanggan (diatur di kode).

## 6. Batas gratis dan biaya

Paket gratis Grafana Cloud punya batas metrik, log, dan masa simpan; cek angkanya di halaman paketmu. Log harian satu toko kecil jauh
di bawah batas. Kalau mendekati batas, kurangi `LOG_LEVEL` atau interval scrape (15 detik di `config.cloud.alloy`).

## Masalah umum

| Gejala | Penyebab | Solusi |
| ------ | -------- | ------ |
| Dashboard kosong | Alloy tidak jalan, atau `METRICS_TOKEN` kosong | `ps`, lalu lihat log Alloy; isi `METRICS_TOKEN` |
| Log Alloy `401`/`403` ke Grafana | `GC_API_KEY` salah, atau scope kurang | Buat token baru dengan `metrics:write` dan `logs:write` |
| Log API tidak muncul | Volume log kosong | `LOG_FILE` sudah diset di compose; cek `docker compose ... exec alloy ls /var/log/cashiermu` |
| Telemetri aplikasi tidak masuk | DNS `telemetry` salah, atau app belum dibuild ulang | Cek `curl` langkah 3.4, build ulang aplikasi |
| Alert tidak pernah datang | Tidak ada contact point atau notification policy | Atur dan uji dengan tombol **Test** |
