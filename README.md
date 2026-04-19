# SFlix Supabase Catalog

Metadata ingestion and read API for movies and TV series.

This project searches titles from SFlix/Consumet, enriches them with TMDb metadata, looks up Indonesian subtitles from OpenSubtitles, stores the normalized catalog in Supabase, and exposes a clean read API for frontend applications.

## What This Project Does

- searches movies and TV shows from the SFlix provider
- enriches metadata with TMDb localized data, including Indonesian titles and overviews
- stores canonical media records, seasons, episodes, external IDs, and subtitle track metadata in Supabase
- stores TMDb-based feed snapshots for `home`, `popular-movies`, and `top-movies`
- exposes a small read-only API for frontend consumption
- supports public API deployment behind Nginx
- supports browser-based frontend access with configurable CORS

## Typical Architecture

```txt
Consumet/SFlix -> Ingest Worker -> TMDb/OpenSubtitles -> Supabase -> app-api -> Frontend
```

In production, the services are typically used like this:

1. `consumet` stays internal
2. `ingestor` runs manually, via cron, or via admin workflow
3. `app-api` is the only service exposed to frontend clients
4. frontend reads catalog data from `app-api`

## Main Features

- canonical movie and TV catalog storage
- Indonesian and English localization fallback
- seasons and episodes for TV content
- subtitle track discovery and ranking
- feed snapshot storage for frontend sections and pagination
- simple HTTP API for list, home, popular, top, detail, seasons, episodes, and subtitles
- Docker Compose deployment for VPS
- domain and SSL setup with Nginx

## Repository Structure

```txt
src/
  app-api/            Read API served to frontend clients
  cli/                Manual CLI commands for ingestion
  providers/          SFlix, TMDb, and OpenSubtitles integrations
  services/           Ingestion pipeline
prisma/               Prisma schema and migrations
supabase/migrations/  SQL schema for Supabase
ConsumetAPI/          Provider service files used by the stack
```

## Quick Start

### Prerequisites

- Node.js `>= 24`
- npm
- PostgreSQL / Supabase project
- TMDb API token
- optional OpenSubtitles API key
- Docker and Docker Compose plugin for VPS deployment

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

Minimum variables you should set:

```env
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

APP_API_PORT=4000
APP_API_CORS_ALLOWED_ORIGINS=*

SFLIX_BASE_URL=local://consumet

TMDB_API_TOKEN=your-tmdb-v4-bearer-token

OPENSUBTITLES_API_KEY=your-opensubtitles-api-key
OPENSUBTITLES_USER_AGENT=sflix-catalog-bot v0.1.0
```

Notes:

- `APP_API_CORS_ALLOWED_ORIGINS=*` allows browser access from any origin
- replace `*` with a comma-separated origin list if you want to lock it down later
- if `OPENSUBTITLES_API_KEY` is empty, subtitle discovery will return no subtitle tracks

### 3. Apply database schema

Run the SQL migrations in [`supabase/migrations`](./supabase/migrations).

If you use Prisma migrations directly, the project also includes [`prisma/migrations`](./prisma/migrations).

### 4. Ingest a title

```bash
npm run ingest:search -- "breaking bad"
```

The query-based CLI:

- searches SFlix
- takes the first `INGEST_DEFAULT_LIMIT` results
- enriches each result with TMDb when possible
- stores media, localizations, seasons, episodes, external IDs, and subtitle metadata

You can also ingest movie feeds directly:

```bash
npm run ingest:home -- --page=1 --limit=20
npm run ingest:popular-movies -- --page=1 --limit=20
npm run ingest:top-movies -- --page=1 --limit=20
```

Feed ingestion:

- uses TMDb movie feeds as the batch source
- resolves each movie into a matching SFlix item before ingesting
- ingests only movie entries
- skips TV entries
- stores feed pages by TMDb source page and resolved media match
- uses the same normalization pipeline as title search after the SFlix match is found
- stores the feed page in `media_feed_items` so frontend can read the same page later

### 5. Start the read API

```bash
npm run api:start
```

Health check:

```bash
curl http://127.0.0.1:4000/health
```

## Usage

### Search and ingest

```bash
npm run ingest:search -- "the batman"
```

### Batch ingest from movie feeds

Home feed movies:

```bash
npm run ingest:home -- --page=1 --limit=20
npm run ingest:home -- --page=2 --limit=20
```

Popular movies:

```bash
npm run ingest:popular-movies -- --page=1 --limit=20
```

Top movies:

```bash
npm run ingest:top-movies -- --page=1 --limit=20
```

Notes:

- `ingest:home` builds the home feed from TMDb trending, popular, and upcoming movies for the requested page
- `ingest:popular-movies` ingests the selected TMDb popular movies page
- `ingest:top-movies` ingests the selected TMDb top rated movies page
- `--limit` defaults to `20` for feed ingest commands
- `ingest:home` also supports `--offset`, but `--page` is the recommended public-facing option

### Read from the API

Get stored home feed page:

```bash
curl "http://127.0.0.1:4000/api/home?page=1&limit=20&lang=id"
curl "http://127.0.0.1:4000/api/home?page=2&limit=20&lang=id"
```

Get stored popular movies page:

```bash
curl "http://127.0.0.1:4000/api/popular-movies?page=1&limit=20&lang=id"
```

Get stored top movies page:

```bash
curl "http://127.0.0.1:4000/api/top-movies?page=1&limit=20&lang=id"
```

List media:

```bash
curl "http://127.0.0.1:4000/api/media?q=breaking%20bad&lang=id&page=1&limit=20"
```

Get media detail:

```bash
curl "http://127.0.0.1:4000/api/media/<publicId>?lang=id"
```

Get seasons:

```bash
curl "http://127.0.0.1:4000/api/media/<publicId>/seasons"
```

Get episodes:

```bash
curl "http://127.0.0.1:4000/api/media/<publicId>/episodes?seasonNumber=1"
```

Get subtitles:

```bash
curl "http://127.0.0.1:4000/api/media/<publicId>/subtitles?lang=id"
curl "http://127.0.0.1:4000/api/media/<publicId>/episodes/1/1/subtitles?lang=id"
```

Full endpoint reference: [API_REFERENCE.md](./API_REFERENCE.md)

## Docker Compose Deployment

The included [`docker-compose.yml`](./docker-compose.yml) runs:

- `consumet` on `127.0.0.1:3010`
- `app-api` on `127.0.0.1:4010`
- `ingestor` as a manual worker profile

Start the public read API stack:

```bash
docker compose up -d consumet app-api
```

Run manual ingestion:

```bash
docker compose --profile manual run --rm ingestor npm run ingest:search -- "breaking bad"
docker compose --profile manual run --rm ingestor npm run ingest:home -- --page=1 --limit=20
docker compose --profile manual run --rm ingestor npm run ingest:popular-movies -- --page=1 --limit=20
docker compose --profile manual run --rm ingestor npm run ingest:top-movies -- --page=1 --limit=20
```

Verify:

```bash
curl http://127.0.0.1:4010/health
```

Detailed deployment docs:

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [NGINX_DOMAIN_SETUP.md](./NGINX_DOMAIN_SETUP.md)

## Frontend Integration

This project is intended to be consumed from a separate frontend.

Example:

```ts
const response = await fetch("https://api.buffers.site/api/home?page=1&limit=20&lang=id");

const data = await response.json();
console.log(data.items);
```

Because `app-api` now supports CORS, browser-based frontends on a different origin can call it directly when `APP_API_CORS_ALLOWED_ORIGINS` is configured appropriately.

Recommended production shape:

- expose only `app-api`
- keep `consumet` private
- run ingest separately from frontend traffic
- place `app-api` behind Nginx, SSL, and rate limiting

## Environment Variables

### Required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used by the backend |
| `TMDB_API_TOKEN` | TMDb v4 bearer token |

### Common

| Variable | Default | Description |
| --- | --- | --- |
| `DIRECT_URL` | unset | Direct Postgres connection, preferred for Prisma adapter |
| `APP_API_PORT` | `4000` | Port used by the read API |
| `APP_API_CORS_ALLOWED_ORIGINS` | `*` | Comma-separated allowed browser origins or `*` |
| `SFLIX_BASE_URL` | `local://consumet` | SFlix provider source |
| `TMDB_DEFAULT_LANGUAGE` | `id-ID` | Preferred TMDb localization |
| `TMDB_FALLBACK_LANGUAGE` | `en-US` | Fallback TMDb language |
| `TMDB_IMAGE_BASE_URL` | `https://image.tmdb.org/t/p/w500` | TMDb image base URL |
| `OPENSUBTITLES_API_BASE_URL` | `https://api.opensubtitles.com/api/v1` | OpenSubtitles API base |
| `OPENSUBTITLES_API_KEY` | unset | Subtitle discovery key |
| `OPENSUBTITLES_USER_AGENT` | `sflix-catalog-bot v0.1.0` | OpenSubtitles user agent |
| `OPENSUBTITLES_TARGET_LANGUAGE` | `id` | Subtitle target language |
| `OPENSUBTITLES_DOWNLOADS_ENABLED` | `false` | Reserved for later subtitle download workflows |
| `INGEST_DEFAULT_LIMIT` | `3` | Max search results processed per query |

## Available Scripts

```bash
npm run build
npm run typecheck
npm run api:start
npm run ingest:search -- "movie title"
npm run ingest:home -- --page=1 --limit=20
npm run ingest:popular-movies -- --page=1 --limit=20
npm run ingest:top-movies -- --page=1 --limit=20
npm run ingest:subtitles
```

Notes:

- `npm run ingest:subtitles` is currently a placeholder and not implemented as a separate worker
- supported ingestion paths today include title search and movie-feed batch ingestion

## Data Model Overview

Main tables:

- `public.media`
- `public.media_external_ids`
- `public.media_localizations`
- `public.seasons`
- `public.episodes`
- `public.episode_external_ids`
- `public.media_feed_items`
- `public.subtitle_tracks`
- `internal.ingestion_jobs`
- `internal.provider_payloads`

The Prisma schema is available at [`prisma/schema.prisma`](./prisma/schema.prisma).

## Operational Notes

- this project stores normalized metadata and subtitle track metadata, not streaming URLs as canonical data
- `consumet` should stay internal whenever possible
- the read API is currently unauthenticated; put it behind domain-level protection, rate limiting, or upstream auth if needed
- subtitle availability depends on OpenSubtitles matches and configured credentials

## Limitations

- subtitle backfill worker is not implemented separately yet
- ingestion currently works best as a manual or scheduled admin workflow
- feed-based batch ingest currently covers `home`, `popular-movies`, and `top-movies`
- feed read endpoints return only data that has already been ingested and stored
- public API auth, quota control, and rate limiting are expected to be handled at the reverse proxy or infrastructure layer

## Recommended Public Deployment

For a public API setup like `https://api.buffers.site`:

1. run `app-api` on `127.0.0.1:4010`
2. create a dedicated Nginx site for `api.buffers.site`
3. proxy public traffic to `127.0.0.1:4010`
4. enable SSL with Certbot
5. keep `consumet` private on `127.0.0.1:3010`

Use this guide: [NGINX_DOMAIN_SETUP.md](./NGINX_DOMAIN_SETUP.md)

## License and Provider Responsibility

You are responsible for complying with the terms of service and legal requirements of any upstream provider you use, including SFlix/Consumet, TMDb, OpenSubtitles, Supabase, and your hosting environment.
