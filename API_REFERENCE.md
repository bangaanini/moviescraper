# API Reference

Base URL examples:

- local: `http://127.0.0.1:4000`
- Docker on VPS: `http://127.0.0.1:4010`
- public domain: `https://api.buffers.site`

All endpoints return JSON.

## Health

### `GET /health`

Response:

```json
{
  "ok": true,
  "service": "app-api"
}
```

## List Media

### `GET /api/media`

Query parameters:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `q` | string | none | Search query |
| `type` | `movie` or `tv` | none | Filter by media type |
| `lang` | string | `id` | Preferred localization language |
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Page size, max `100` |

Example:

```bash
curl "https://api.buffers.site/api/media?q=breaking%20bad&lang=id&page=1&limit=20"
```

Response shape:

```json
{
  "items": [
    {
      "publicId": "378cfb51-9777-4a00-80b8-6d1afae12d96",
      "type": "tv",
      "title": "Breaking Bad",
      "overview": "Ketika Walter White...",
      "originalTitle": "Breaking Bad",
      "releaseYear": 2008,
      "runtimeMinutes": null,
      "posterUrl": "https://image.tmdb.org/t/p/w500/...",
      "backdropUrl": "https://image.tmdb.org/t/p/w500/...",
      "popularity": 117.404,
      "voteAverage": 8.94,
      "voteCount": 17534,
      "metadataSource": "tmdb",
      "subtitleSource": "opensubtitles",
      "subtitleTrackCount": 0,
      "localization": {
        "lang": "id",
        "sourceProvider": "tmdb",
        "sourceKind": "localized",
        "confidence": 0.95
      },
      "updatedAt": "2026-04-19T07:20:28.039Z"
    }
  ],
  "page": 1,
  "limit": 20
}
```

## Media Detail

### `GET /api/media/:publicId`

Query parameters:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `lang` | string | `id` | Preferred localization language |

Example:

```bash
curl "https://api.buffers.site/api/media/378cfb51-9777-4a00-80b8-6d1afae12d96?lang=id"
```

Response shape:

```json
{
  "publicId": "378cfb51-9777-4a00-80b8-6d1afae12d96",
  "type": "tv",
  "title": "Breaking Bad",
  "overview": "Ketika Walter White...",
  "originalTitle": "Breaking Bad",
  "originalOverview": "When Walter White...",
  "releaseYear": 2008,
  "originalLanguage": "en",
  "status": "Ended",
  "runtimeMinutes": null,
  "posterUrl": "https://image.tmdb.org/t/p/w500/...",
  "backdropUrl": "https://image.tmdb.org/t/p/w500/...",
  "popularity": 117.404,
  "voteAverage": 8.94,
  "voteCount": 17534,
  "adult": false,
  "metadataSource": "tmdb",
  "subtitleSource": "opensubtitles",
  "ingestionConfidence": 0.95,
  "externalIds": [
    {
      "provider": "tmdb",
      "externalId": "1396",
      "externalUrl": "https://www.themoviedb.org/tv/1396",
      "isPrimary": true
    }
  ],
  "localizations": [],
  "seasons": [],
  "subtitles": [],
  "updatedAt": "2026-04-19T07:20:28.039Z"
}
```

## Seasons

### `GET /api/media/:publicId/seasons`

Example:

```bash
curl "https://api.buffers.site/api/media/378cfb51-9777-4a00-80b8-6d1afae12d96/seasons"
```

Response shape:

```json
{
  "items": [
    {
      "seasonNumber": 1,
      "title": "Season 1",
      "overview": "Overview...",
      "airDate": "2008-01-20",
      "posterUrl": "https://image.tmdb.org/t/p/w500/...",
      "episodeCount": 7
    }
  ]
}
```

## Episodes

### `GET /api/media/:publicId/episodes`

Query parameters:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `seasonNumber` | number | none | Filter by season |

Example:

```bash
curl "https://api.buffers.site/api/media/378cfb51-9777-4a00-80b8-6d1afae12d96/episodes?seasonNumber=1"
```

Response shape:

```json
{
  "items": [
    {
      "seasonNumber": 1,
      "episodeNumber": 1,
      "title": "Pilot",
      "overview": "Overview...",
      "releaseDate": "2008-01-20",
      "runtimeMinutes": 58,
      "stillUrl": "https://image.tmdb.org/t/p/w500/...",
      "subtitleTrackCount": 0
    }
  ]
}
```

## Media Subtitles

### `GET /api/media/:publicId/subtitles`

Query parameters:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `lang` | string | `id` | Subtitle language |
| `limit` | number | `3` | Max subtitle tracks returned |

Example:

```bash
curl "https://api.buffers.site/api/media/378cfb51-9777-4a00-80b8-6d1afae12d96/subtitles?lang=id"
```

Response shape:

```json
{
  "items": [
    {
      "rank": 1,
      "isPreferred": true,
      "provider": "opensubtitles",
      "languageCode": "id",
      "externalSubtitleId": "12345",
      "externalFileId": "67890",
      "releaseName": "WEBRip",
      "fileName": "subtitle.srt",
      "format": "srt",
      "isHearingImpaired": false,
      "isAiGenerated": false,
      "sourceKind": "discovered",
      "downloadUrl": null,
      "storagePath": null,
      "downloadStatus": "discovered",
      "score": 9.8,
      "downloadsCount": 120,
      "updatedAt": "2026-04-19T07:20:28.039Z"
    }
  ]
}
```

## Episode Subtitles

### `GET /api/media/:publicId/episodes/:seasonNumber/:episodeNumber/subtitles`

Query parameters:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `lang` | string | `id` | Subtitle language |
| `limit` | number | `3` | Max subtitle tracks returned |

Example:

```bash
curl "https://api.buffers.site/api/media/378cfb51-9777-4a00-80b8-6d1afae12d96/episodes/1/1/subtitles?lang=id"
```

Response shape:

```json
{
  "items": [
    {
      "rank": 1,
      "isPreferred": true,
      "provider": "opensubtitles",
      "languageCode": "id",
      "externalSubtitleId": "12345",
      "externalFileId": "67890",
      "releaseName": "WEBRip",
      "fileName": "subtitle.srt",
      "format": "srt",
      "isHearingImpaired": false,
      "isAiGenerated": false,
      "sourceKind": "discovered",
      "downloadUrl": null,
      "storagePath": null,
      "downloadStatus": "discovered",
      "score": 9.8,
      "downloadsCount": 120,
      "updatedAt": "2026-04-19T07:20:28.039Z"
    }
  ]
}
```

## Error Responses

Common responses:

```json
{
  "error": "Not found"
}
```

```json
{
  "error": "Internal server error"
}
```

For invalid input, the API may also return `500` if a handler throws on malformed query values such as an invalid integer or unsupported media type. If you expose this API publicly, it is worth normalizing those cases to `400` in a future revision.

## CORS

The API supports browser access with CORS.

Configured by:

```env
APP_API_CORS_ALLOWED_ORIGINS=*
```

Examples:

- allow all origins:

```env
APP_API_CORS_ALLOWED_ORIGINS=*
```

- allow only specific frontend origins:

```env
APP_API_CORS_ALLOWED_ORIGINS=https://frontend.example.com,https://app.example.com
```
