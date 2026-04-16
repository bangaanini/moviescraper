# SFlix Catalog Ingest

Pipeline ini mengambil hasil pencarian dari SFlix/Consumet, memperkaya metadata dengan TMDb berbahasa Indonesia, lalu mencari subtitle Indonesia dari OpenSubtitles dan menyimpannya ke Supabase.

## Kenapa arsitekturnya dipisah

- `SFlix` dipakai untuk menemukan item dan provider-specific IDs.
- `TMDb` dipakai untuk metadata kanonik dan localizations, termasuk `id-ID`.
- `OpenSubtitles.com` dipakai untuk subtitle Indonesia.
- URL stream yang sifatnya sementara tidak disimpan sebagai data kanonik. Simpan identifier provider, lalu resolve stream saat dibutuhkan.

## Struktur utama database

- `public.media`: entity film/serial kanonik
- `public.media_external_ids`: ID lintas provider seperti `tmdb`, `imdb`, `sflix`
- `public.media_localizations`: judul dan overview per bahasa
- `public.seasons`
- `public.episodes`
- `public.episode_external_ids`
- `public.subtitle_tracks`
- `internal.ingestion_jobs`
- `internal.provider_payloads`

## Setup

1. Copy `.env.example` menjadi `.env`
2. Isi kredensial `Supabase`, `TMDb`, dan `OpenSubtitles`
3. Install dependencies:

```bash
npm install
```

4. Jalankan migration SQL di proyek Supabase Anda
5. Untuk test lokal cepat, gunakan mode direct provider dengan:

```txt
SFLIX_BASE_URL=local://consumet
```

Mode ini memakai provider Consumet langsung dari folder `ConsumetAPI`, jadi tidak perlu menjalankan service HTTP Consumet dulu.

6. Jalankan ingest:

```bash
npm run ingest:search -- "breaking bad"
```

7. Jika memakai stack Docker penuh, `docker-compose.yml` akan override `SFLIX_BASE_URL` menjadi `http://consumet:3000`.

## Catatan implementasi

- `TMDb` dijadikan sumber canonical key jika match ditemukan.
- Jika TMDb tidak match, fallback ke identitas `sflix`.
- Subtitle Indonesia disimpan sebagai track metadata lebih dulu. Download file subtitle bisa diaktifkan belakangan setelah kredensial OpenSubtitles lengkap.
- Untuk pipeline produksi, gunakan queue/cron dan batch ingest, bukan request sinkron dari frontend.
# moviescraper
