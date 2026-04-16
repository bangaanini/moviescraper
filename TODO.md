# TODO Proyek: SFlix Scraper -> Backend -> Frontend

Dokumen ini jadi pegangan kerja agar alur implementasi tidak bercampur.

## Keputusan Arsitektur

- `Consumet` di-deploy ke VPS sebagai service internal.
- `Project ingest/backend` ini juga di-deploy ke VPS sebagai service terpisah.
- `Supabase` dipakai untuk database, storage, dan bisa dipakai untuk cron/admin API ringan.
- `Frontend` tidak boleh memanggil Consumet langsung.
- `Frontend` membaca data hasil ingest dari backend atau langsung dari Supabase sesuai kebutuhan.
- `TMDb` dipakai untuk metadata Indonesia.
- `OpenSubtitles` dipakai untuk subtitle Indonesia.

## Alur Data Final

1. Frontend meminta katalog atau detail film ke backend aplikasi.
2. Backend membaca data bersih dari Supabase.
3. Scraper/ingest worker berjalan terpisah di VPS.
4. Ingest worker mengambil data dari Consumet.
5. Ingest worker memperkaya data dari TMDb dan OpenSubtitles.
6. Ingest worker menyimpan hasil akhir ke Supabase.
7. Frontend hanya menampilkan data yang sudah disanitasi dan disimpan.

## Batas Tanggung Jawab

### 1. Consumet service

- Menyediakan endpoint scraping/provider seperti SFlix.
- Tidak menjadi source utama frontend.
- Hanya dipakai oleh worker/backend internal.

### 2. Ingest/backend service

- Menjalankan pencarian, normalisasi, enrichment, dan penyimpanan data.
- Menentukan canonical media record.
- Menyimpan metadata Indonesia dan subtitle Indonesia ke Supabase.
- Menyediakan endpoint internal/admin bila perlu untuk trigger ingest manual.

### 3. App API

- Menjadi backend baca untuk frontend.
- Mengambil data yang sudah dinormalisasi dari Supabase.
- Menyediakan endpoint katalog, detail, season, episode, dan subtitle.

### 4. Supabase

- Menyimpan `media`, `media_external_ids`, `media_localizations`, `seasons`, `episodes`, `subtitle_tracks`.
- Menyimpan payload mentah provider bila perlu audit/debug.
- Menjadi source baca utama untuk frontend.

### 5. Frontend

- Menampilkan katalog dari data Supabase/backend.
- Tidak memanggil provider scraping secara langsung.
- Tidak menyimpan logic matching provider.

## Urutan Kerja yang Disarankan

### Fase 1: Stabilkan infrastruktur dasar

- [ ] Siapkan 1 VPS untuk semua service awal.
- [ ] Install Docker dan Docker Compose di VPS.
- [ ] Siapkan reverse proxy (`nginx` atau `caddy`).
- [ ] Siapkan domain/subdomain:
- [ ] `consumet.domainanda.com`
- [ ] `api.domainanda.com`
- [ ] `app.domainanda.com` jika frontend ikut di VPS
- [ ] Siapkan firewall dasar dan hanya buka port yang perlu.

### Fase 2: Deploy Consumet ke VPS

- [ ] Clone repo `consumet/api.consumet.org` ke VPS.
- [ ] Jalankan dengan Docker atau PM2.
- [ ] Pastikan endpoint internal bisa diakses dari backend.
- [ ] Tambahkan healthcheck.
- [ ] Catat base URL internal yang dipakai project ini.
- [ ] Jangan expose endpoint yang tidak diperlukan bila bisa dibatasi reverse proxy.
- [ ] Gunakan hostname internal Docker `http://consumet:3000` untuk komunikasi dengan scraper.

### Fase 3: Finalisasi Supabase

- [ ] Pastikan migration proyek ini sudah dijalankan ke Supabase.
- [ ] Verifikasi semua tabel utama sudah terbentuk.
- [ ] Verifikasi RLS untuk tabel publik.
- [ ] Tambahkan bucket storage jika nanti subtitle ingin diunduh dan disimpan.
- [ ] Buat service role key khusus server dan simpan aman di VPS.

### Fase 4: Finalisasi backend/ingest project ini

- [ ] Pastikan `.env` server memakai base URL Consumet self-hosted, bukan `api.consumet.org`.
- [ ] Gunakan `SFLIX_BASE_URL=http://consumet:3000` bila dijalankan lewat Docker Compose.
- [ ] Pastikan kredensial TMDb valid.
- [ ] Pastikan kredensial OpenSubtitles valid.
- [ ] Jalankan test ingest dengan 1 query contoh.
- [ ] Verifikasi row masuk ke `media`.
- [ ] Verifikasi localizations `id` dan `en`.
- [ ] Verifikasi external IDs `sflix/tmdb/imdb`.
- [ ] Verifikasi subtitle track Indonesia masuk ke `subtitle_tracks`.

### Fase 5: Tambahkan operasional ingest

- [ ] Buat endpoint admin/internal untuk trigger ingest manual.
- [ ] Buat mode batch ingest untuk daftar judul populer.
- [ ] Buat cron berkala untuk refresh metadata.
- [ ] Buat cron berkala untuk refresh subtitle yang belum tersedia.
- [ ] Tambahkan status job dan logging yang lebih detail.
- [ ] Tambahkan retry untuk provider yang gagal.

### Fase 6: Tambahkan kualitas data

- [ ] Tambahkan rule matching TMDb yang lebih ketat:
- [ ] berdasarkan title + year
- [ ] fallback ke IMDb ID bila tersedia
- [ ] hindari salah match serial vs movie
- [ ] Tambahkan flag `missing_metadata`.
- [ ] Tambahkan flag `missing_subtitles`.
- [ ] Tambahkan review queue untuk item yang match confidence rendah.

### Fase 7: Tambahkan subtitle workflow

- [ ] Saat ini subtitle baru tahap discovery.
- [ ] Tambahkan worker download subtitle dari OpenSubtitles jika memang diperlukan.
- [ ] Simpan file subtitle ke Supabase Storage atau object storage lain.
- [ ] Simpan `storage_path` final di `subtitle_tracks`.
- [ ] Tentukan format subtitle yang didukung frontend (`vtt` paling praktis untuk web player).

### Fase 8: Siapkan backend konsumsi frontend

- [x] Buat endpoint katalog publik:
- [x] list movies
- [x] list tv series
- [x] detail movie/series
- [x] season/episode list
- [x] subtitle list
- [x] Buat endpoint pencarian internal dari data Supabase.
- [ ] Jangan jadikan frontend tergantung langsung pada struktur tabel mentah.
- [ ] Tambahkan caching untuk endpoint yang sering dibaca.

### Fase 9: Siapkan frontend

- [ ] Frontend baca katalog dari backend/Supabase, bukan dari Consumet.
- [ ] Tampilkan judul Indonesia bila tersedia.
- [ ] Fallback ke English/original title bila localization belum ada.
- [ ] Tampilkan status subtitle Indonesia.
- [ ] Pisahkan halaman katalog, detail, dan player.
- [ ] Pastikan player bisa memilih track subtitle Indonesia.

### Fase 10: Hardening produksi

- [ ] Tambahkan structured logging di semua service.
- [ ] Tambahkan monitoring uptime untuk Consumet dan backend.
- [ ] Tambahkan backup database Supabase.
- [ ] Tambahkan alert untuk job ingest yang gagal berulang.
- [ ] Rate limit endpoint admin/internal.
- [ ] Pisahkan environment `development`, `staging`, `production`.

## Risiko yang Harus Diingat

- Sumber scraping seperti SFlix/Consumet bisa berubah sewaktu-waktu.
- Endpoint publik Consumet lama tidak bisa diandalkan.
- Match TMDb bisa salah bila hanya mengandalkan judul.
- Subtitle Indonesia tidak selalu tersedia untuk semua item.
- URL stream provider bisa bersifat sementara dan sebaiknya tidak dijadikan data permanen utama.
- Legal dan ToS provider harus selalu dipertimbangkan sebelum publikasi.

## Aturan Implementasi

- Jangan panggil Consumet langsung dari frontend.
- Jangan simpan stream URL sebagai canonical source permanen.
- Simpan raw payload hanya untuk debug/audit, bukan untuk query utama frontend.
- Semua query frontend sebaiknya membaca data yang sudah dinormalisasi.
- Semua proses ingest harus idempotent sebisa mungkin.

## Next Action Paling Dekat

- [ ] Ganti `SFLIX_BASE_URL` proyek ini ke instance Consumet di VPS setelah service hidup.
- [ ] Deploy Consumet ke VPS.
- [ ] Jalankan ingest test lagi.
- [x] Setelah ingest berhasil, buat endpoint backend untuk frontend.
- [x] Tambahkan service ketiga `app-api` untuk konsumsi frontend.
