import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";

import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { CatalogRepository } from "./catalog-repository.js";

const repository = new CatalogRepository();
const corsConfig = parseCorsAllowedOrigins(env.APP_API_CORS_ALLOWED_ORIGINS);

const routes = [
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/health" }),
    handler: async () => ({ ok: true, service: "app-api" })
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/media" }),
    handler: async (request: Request) => {
      const url = new URL(request.url);
      const type = parseMediaType(url.searchParams.get("type"));
      const lang = normalizeLang(url.searchParams.get("lang"));
      const page = parsePositiveInteger(url.searchParams.get("page"), 1);
      const limit = parsePositiveInteger(url.searchParams.get("limit"), 20, 100);
      const q = optionalString(url.searchParams.get("q"));

      return repository.listMedia({
        lang,
        page,
        limit,
        ...(type ? { type } : {}),
        ...(q ? { query: q } : {})
      });
    }
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/media/:publicId" }),
    handler: async (request: Request, match: URLPatternResult) => {
      const lang = normalizeLang(new URL(request.url).searchParams.get("lang"));
      const publicId = requiredPathGroup(match, "publicId");
      const item = await repository.getMediaByPublicId(publicId, lang);

      if (!item) {
        return jsonResponse({ error: "Media not found" }, 404);
      }

      return item;
    }
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/media/:publicId/seasons" }),
    handler: async (_request: Request, match: URLPatternResult) => ({
      items: await repository.getSeasons(requiredPathGroup(match, "publicId"))
    })
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/media/:publicId/episodes" }),
    handler: async (request: Request, match: URLPatternResult) => {
      const seasonNumber = optionalPositiveInteger(new URL(request.url).searchParams.get("seasonNumber"));
      return {
        items: await repository.getEpisodes(requiredPathGroup(match, "publicId"), seasonNumber)
      };
    }
  },
  {
    method: "GET",
    pattern: new URLPattern({ pathname: "/api/media/:publicId/subtitles" }),
    handler: async (request: Request, match: URLPatternResult) => {
      const url = new URL(request.url);
      return {
        items: await repository.getMediaSubtitles({
        publicId: requiredPathGroup(match, "publicId"),
          languageCode: normalizeLang(url.searchParams.get("lang")),
          limit: parsePositiveInteger(url.searchParams.get("limit"), 3, 20)
        })
      };
    }
  },
  {
    method: "GET",
    pattern: new URLPattern({
      pathname: "/api/media/:publicId/episodes/:seasonNumber/:episodeNumber/subtitles"
    }),
    handler: async (request: Request, match: URLPatternResult) => {
      const url = new URL(request.url);
      return {
        items: await repository.getEpisodeSubtitles({
        publicId: requiredPathGroup(match, "publicId"),
        seasonNumber: parsePositiveInteger(requiredPathGroup(match, "seasonNumber"), 1),
        episodeNumber: parsePositiveInteger(requiredPathGroup(match, "episodeNumber"), 1),
          languageCode: normalizeLang(url.searchParams.get("lang")),
          limit: parsePositiveInteger(url.searchParams.get("limit"), 3, 20)
        })
      };
    }
  }
] as const;

const server = createServer(async (incomingRequest, outgoingResponse) => {
  const requestUrl = new URL(
    incomingRequest.url ?? "/",
    `http://${incomingRequest.headers.host ?? "127.0.0.1"}`
  );

  const request = new Request(requestUrl, {
    method: incomingRequest.method ?? "GET",
    headers: toHeaders(incomingRequest.headers)
  });
  const corsHeaders = buildCorsHeaders(request);

  try {
    if (request.method === "OPTIONS") {
      await writeResponse(outgoingResponse, new Response(null, { status: 204, headers: corsHeaders }));
      return;
    }

    for (const route of routes) {
      if (route.method !== request.method) {
        continue;
      }

      const match = route.pattern.exec(request.url);
      if (!match) {
        continue;
      }

      const result = await route.handler(request, match);
      const response = result instanceof Response ? result : jsonResponse(result);
      await writeResponse(outgoingResponse, withCorsHeaders(response, corsHeaders));
      return;
    }

    await writeResponse(
      outgoingResponse,
      withCorsHeaders(jsonResponse({ error: "Not found" }, 404), corsHeaders)
    );
  } catch (error) {
    logger.error(
      {
        method: request.method,
        path: requestUrl.pathname,
        err: error
      },
      "app-api request failed"
    );

    await writeResponse(
      outgoingResponse,
      withCorsHeaders(jsonResponse({ error: "Internal server error" }, 500), corsHeaders)
    );
  }
});

server.listen(env.APP_API_PORT, "0.0.0.0", () => {
  logger.info({ port: env.APP_API_PORT }, "app-api listening");
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function withCorsHeaders(response: Response, corsHeaders: Headers) {
  const headers = new Headers(response.headers);

  for (const [key, value] of corsHeaders.entries()) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function writeResponse(outgoingResponse: ServerResponse, response: Response) {
  outgoingResponse.statusCode = response.status;

  for (const [key, value] of response.headers.entries()) {
    outgoingResponse.setHeader(key, value);
  }

  outgoingResponse.end(await response.text());
}

function toHeaders(headers: IncomingHttpHeaders) {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    result.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return result;
}

function parseMediaType(value: string | null): "movie" | "tv" | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "movie" || value === "tv") {
    return value;
  }

  throw new Error("Invalid media type");
}

function parsePositiveInteger(
  value: string | null | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER
) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Invalid positive integer");
  }

  return Math.min(parsed, max);
}

function optionalPositiveInteger(value: string | null) {
  if (value == null || value === "") {
    return undefined;
  }

  return parsePositiveInteger(value, 1);
}

function normalizeLang(value: string | null) {
  if (!value) {
    return "id";
  }

  const normalized = value.toLowerCase();
  if (normalized.startsWith("id")) {
    return "id";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }

  return normalized;
}

function optionalString(value: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredPathGroup(match: URLPatternResult, key: string) {
  const value = match.pathname.groups[key];

  if (!value) {
    throw new Error(`Missing path parameter: ${key}`);
  }

  return value;
}

function parseCorsAllowedOrigins(value: string) {
  const origins = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (origins.length === 0 || origins.includes("*")) {
    return { allowAnyOrigin: true, origins: [] as string[] };
  }

  return { allowAnyOrigin: false, origins };
}

function buildCorsHeaders(request: Request) {
  const headers = new Headers({
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400"
  });

  if (corsConfig.allowAnyOrigin) {
    headers.set("access-control-allow-origin", "*");
    return headers;
  }

  const origin = request.headers.get("origin");

  if (origin && corsConfig.origins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }

  return headers;
}
