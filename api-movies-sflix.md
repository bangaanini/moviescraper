# Consumet Movies API: SFlix

Dokumen ini merapikan endpoint `movies/sflix` dari Consumet agar lebih mudah dibaca.

## 1. Search

**Endpoint**

`GET https://api.consumet.org/movies/sflix/{query}`

**Path parameter**

- `query` (`string`)

### Request sample

```js
import axios from "axios";

const query = "breaking bad";
const url = `https://api.consumet.org/movies/sflix/${encodeURIComponent(query)}`;

async function fetchSearchResults() {
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (err) {
    throw new Error(err.message);
  }
}

fetchSearchResults().then(console.log);
```

### Response `200 OK`

```json
{
  "currentPage": 1,
  "hasNextPage": true,
  "results": [
    {
      "id": "string",
      "url": "string",
      "title": "string",
      "image": "string",
      "releaseDate": "string",
      "type": "Movie"
    }
  ]
}
```

## 2. Get Media Info

**Endpoint**

`GET https://api.consumet.org/movies/sflix/info?id={id}`

**Query parameter**

- `id` (`string`)

### Request sample

```js
import axios from "axios";

const url = "https://api.consumet.org/movies/sflix/info";

async function fetchMediaInfo() {
  try {
    const { data } = await axios.get(url, {
      params: { id: "tv/watch-breaking-bad-39441" }
    });
    return data;
  } catch (err) {
    throw new Error(err.message);
  }
}

fetchMediaInfo().then(console.log);
```

### Response `200 OK`

```json
{
  "id": "string",
  "title": "string",
  "url": "string",
  "image": "string",
  "releaseDate": "string",
  "description": "string",
  "genres": [
    "string"
  ],
  "type": "Movie",
  "casts": [
    "string"
  ],
  "tags": [
    "string"
  ],
  "production": "string",
  "duration": "string",
  "episodes": [
    {
      "id": "string",
      "url": "string",
      "title": "string",
      "number": 0,
      "season": 0
    }
  ]
}
```

### Response `400 Bad Request`

```json
{
  "message": "id is required"
}
```

### Response `404 Not Found`

```json
{
  "message": "Media not found"
}
```

## 3. Get Episode Stream Links

**Endpoint**

`GET https://api.consumet.org/movies/sflix/watch?episodeId={episodeId}&mediaId={mediaId}`

**Query parameters**

- `episodeId` (`string`)
- `mediaId` (`string`)

### Request sample

```js
import axios from "axios";

const url = "https://api.consumet.org/movies/sflix/watch";

async function fetchEpisodeStreamLinks() {
  try {
    const { data } = await axios.get(url, {
      params: {
        episodeId: "1001",
        mediaId: "tv/watch-breaking-bad-39441"
      }
    });
    return data;
  } catch (err) {
    throw new Error(err.message);
  }
}

fetchEpisodeStreamLinks().then(console.log);
```

### Response `200 OK`

```json
{
  "headers": {
    "Referer": "string"
  },
  "sources": [
    {
      "url": "string",
      "quality": "string",
      "isM3U8": true
    }
  ],
  "subtitles": [
    {
      "url": "string",
      "lang": "string"
    }
  ]
}
```

### Response `404 Not Found`

```json
{
  "message": "Episode not found"
}
```

### Response `500 Internal Server Error`

```json
{
  "message": "Something went wrong"
}
```

## 4. Get Episode Server

**Endpoint**

`GET https://api.consumet.org/movies/sflix/servers?episodeId={episodeId}&mediaId={mediaId}`

**Query parameters**

- `episodeId` (`string`)
- `mediaId` (`string`)

### Request sample

```js
import axios from "axios";

const url = "https://api.consumet.org/movies/sflix/servers";

async function fetchEpisodeServers() {
  try {
    const { data } = await axios.get(url, {
      params: {
        episodeId: "1001",
        mediaId: "tv/watch-breaking-bad-39441"
      }
    });
    return data;
  } catch (err) {
    throw new Error(err.message);
  }
}

fetchEpisodeServers().then(console.log);
```

### Response `200 OK`

```json
[
  {
    "name": "string",
    "url": "string"
  }
]
```

### Response `404 Not Found`

```json
{
  "message": "Episode not found"
}
```

### Response `500 Internal Server Error`

```json
{
  "message": "Something went wrong"
}
```

## 5. Spotlight

**Endpoint**

`GET https://api.consumet.org/movies/sflix/spotlight`

### Request sample

```js
import axios from "axios";

const url = "https://api.consumet.org/movies/sflix/spotlight";

async function fetchSpotlight() {
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (err) {
    throw new Error(err.message);
  }
}

fetchSpotlight().then(console.log);
```

### Response `200 OK`

```json
{
  "results": [
    {
      "id": "string",
      "title": "string",
      "image": "string",
      "url": "string",
      "releaseDate": "string",
      "duration": "string",
      "type": "Movie"
    }
  ]
}
```

### Response `500 Internal Server Error`

```json
{
  "message": "Something went wrong"
}
```

## 6. Trending

**Endpoint**

`GET https://api.consumet.org/movies/sflix/trending?type={type}`

**Query parameter**

- `type` (`enum`): `"movie"`

### Request sample

```js
import axios from "axios";

const url = "https://api.consumet.org/movies/sflix/trending";

async function fetchTrending() {
  try {
    const { data } = await axios.get(url, {
      params: { type: "movie" }
    });
    return data;
  } catch (err) {
    throw new Error(err.message);
  }
}

fetchTrending().then(console.log);
```

### Response `200 OK`

```json
{
  "results": [
    {
      "id": "string",
      "title": "string",
      "image": "string",
      "url": "string",
      "releaseDate": "string",
      "duration": "string",
      "type": "Movie"
    }
  ]
}
```

### Response `500 Internal Server Error`

```json
{
  "message": "Something went wrong"
}
```
