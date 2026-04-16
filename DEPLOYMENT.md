# Deployment Guide

Dokumen ini menjelaskan cara menjalankan `ConsumetAPI` dan `sflix-supabase-catalog` dalam satu deployment di VPS.

## Arsitektur saat ini

Saat ini proyek dibagi menjadi tiga service:

- `consumet`
  Service scraping provider. Jalan terus di background.
- `ingestor`
  Worker untuk ingest data dari `consumet -> TMDb -> OpenSubtitles -> Supabase`.
- `app-api`
  API baca untuk frontend yang mengambil data bersih dari Supabase.

Catatan penting:

- `ingestor` tetap worker CLI/admin.
- `app-api` adalah backend baca untuk frontend.

## Cara dua service ini saling terhubung

`docker-compose.yml` menghubungkan dua container ini dalam network internal Docker yang sama.

Akibatnya:

- service `ingestor` bisa memanggil `consumet` lewat hostname internal:

```txt
http://consumet:3000
```

- Anda tidak perlu mengarahkan scraper ke domain publik untuk komunikasi internal.
- Variabel yang dipakai adalah:

```txt
SFLIX_BASE_URL=http://consumet:3000
```

## Struktur yang disarankan di VPS

```txt
/opt/streaming-stack/
  docker-compose.yml
  .env
  /ConsumetAPI
  /scraper
```

Jika Anda menyimpan repo scraper ini sebagai root stack, maka isi folder saat ini sudah cukup dekat dengan bentuk itu.

## Prasyarat VPS

- Docker
- Docker Compose plugin
- kredensial `.env` untuk scraper
- kredensial `.env` untuk `ConsumetAPI`

## Setup env

### 1. Env untuk scraper

Gunakan `.env.production.example` sebagai dasar:

```bash
cp .env.production.example .env
```

Pastikan:

```txt
SFLIX_BASE_URL=http://consumet:3000
```

### 2. Env untuk Consumet

Copy dari contoh repo:

```bash
cp ConsumetAPI/.env.example ConsumetAPI/.env
```

Minimal yang penting:

```txt
PORT=3000
NODE_ENV=PROD
```

Tambahkan proxy / Redis / TMDB key hanya jika benar-benar dibutuhkan.

## Build dan start

### Menyalakan Consumet

```bash
docker compose up -d consumet
```

### Menjalankan ingest manual

Contoh:

```bash
docker compose run --rm ingestor npm run ingest:search -- "breaking bad"
```

Atau:

```bash
docker compose --profile manual run --rm ingestor npm run ingest:search -- "the batman"
```

### Menyalakan app-api

```bash
docker compose up -d app-api
```

## Flow deploy yang disarankan

1. Pull/update repo `ConsumetAPI`
2. Pull/update repo scraper ini
3. Update `.env`
4. Build ulang:

```bash
docker compose build --no-cache
```

5. Start ulang `consumet`:

```bash
docker compose up -d consumet
```

6. Start `app-api`:

```bash
docker compose up -d app-api
```

7. Jalankan test ingest:

```bash
docker compose run --rm ingestor npm run ingest:search -- "breaking bad"
```

8. Verifikasi data masuk ke Supabase
9. Verifikasi endpoint `app-api`

## Untuk frontend

Frontend tidak boleh memanggil `consumet` langsung.

Flow final yang sehat:

1. `consumet` scraping provider
2. `ingestor` normalize + enrich + save ke Supabase
3. `app-api` membaca data dari Supabase
4. `frontend` memanggil `app-api`

Expose hanya:

- `app-api`
- optional reverse proxy

Sedangkan `consumet` cukup internal-only bila memungkinkan.

## Endpoint app-api

### Health

```txt
GET /health
```

### List media

```txt
GET /api/media?type=movie&lang=id&page=1&limit=20&q=batman
```

### Detail media

```txt
GET /api/media/:publicId?lang=id
```

### Seasons

```txt
GET /api/media/:publicId/seasons
```

### Episodes

```txt
GET /api/media/:publicId/episodes
GET /api/media/:publicId/episodes?seasonNumber=1
```

### Media subtitles

```txt
GET /api/media/:publicId/subtitles?lang=id
```

### Episode subtitles

```txt
GET /api/media/:publicId/episodes/:seasonNumber/:episodeNumber/subtitles?lang=id
```

## Rekomendasi produksi

- Jangan expose `consumet` ke internet publik kecuali memang perlu.
- Gunakan reverse proxy jika ingin membatasi akses admin/internal.
- Jalankan ingest via cron terpisah setelah testing manual stabil.
- Tambahkan monitoring untuk container `consumet`.
- Siapkan restart policy dan log rotation.
