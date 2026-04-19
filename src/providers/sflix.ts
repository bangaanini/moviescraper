import { createRequire } from "node:module";
import { z } from "zod";

import { env } from "../config/env.js";
import { requestJson } from "../lib/http.js";

const searchResultSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  image: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  type: z.string()
});

const searchResponseSchema = z.object({
  currentPage: z.number(),
  hasNextPage: z.boolean(),
  results: z.array(searchResultSchema)
});

const catalogItemSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  posterImage: z.string().nullable().optional(),
  releaseDate: z.union([z.string(), z.number()]).nullable().optional(),
  type: z.string().nullable().optional()
});

const coercedBooleanSchema = z.union([
  z.boolean(),
  z.string().transform((value) => value.toLowerCase() === "true")
]);

const paginatedCatalogResponseSchema = z.object({
  currentPage: z.coerce.number().optional(),
  hasNextPage: coercedBooleanSchema.optional(),
  lastPage: z.coerce.number().optional(),
  data: z.array(catalogItemSchema).default([])
});

const homeCatalogResponseSchema = z.object({
  featured: z.array(catalogItemSchema).default([]),
  trending: z
    .object({
      Movies: z.array(catalogItemSchema).default([]),
      Tv: z.array(catalogItemSchema).default([])
    })
    .default({
      Movies: [],
      Tv: []
    }),
  recentReleases: z
    .object({
      Movies: z.array(catalogItemSchema).default([]),
      Tv: z.array(catalogItemSchema).default([])
    })
    .default({
      Movies: [],
      Tv: []
    }),
  upcoming: z.array(catalogItemSchema).default([])
});

const providerErrorSchema = z.object({
  error: z.string().min(1)
});

const episodeSchema = z.object({
  id: z.string(),
  url: z.string().nullable().optional(),
  title: z.string(),
  number: z.number().nullable().optional(),
  season: z.number().nullable().optional()
});

const mediaInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  image: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  genres: z.array(z.string()).default([]),
  type: z.string(),
  casts: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  production: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  episodes: z.array(episodeSchema).default([])
});

export type SflixSearchResult = z.infer<typeof searchResultSchema>;
export type SflixMediaInfo = z.infer<typeof mediaInfoSchema>;
export type SflixEpisode = z.infer<typeof episodeSchema>;
export interface SflixCatalogItem {
  id: string;
  title: string;
  image: string | null;
  releaseDate: string | null;
  type: string;
}

export interface SflixPaginatedCatalog {
  items: SflixCatalogItem[];
  currentPage: number | null;
  hasNextPage: boolean | null;
  lastPage: number | null;
}

export interface SflixHomeCatalog {
  featured: SflixCatalogItem[];
  trendingMovies: SflixCatalogItem[];
  recentMovieReleases: SflixCatalogItem[];
  upcoming: SflixCatalogItem[];
}

type DirectSflixProvider = {
  search: (query: string, page?: number) => Promise<unknown>;
  fetchMediaInfo: (id: string) => Promise<unknown>;
};

type DirectFlixhqFeedProvider = {
  fetchHome: () => Promise<unknown>;
  fetchPopularMovies: (page?: number) => Promise<unknown>;
  fetchTopMovies: (page?: number) => Promise<unknown>;
};

export class SflixClient {
  private readonly isDirectMode = env.SFLIX_BASE_URL.startsWith("local://");

  private readonly baseUrl = this.isDirectMode
    ? null
    : new URL("/movies/sflix/", env.SFLIX_BASE_URL);

  private readonly flixhqBaseUrl = this.isDirectMode
    ? null
    : new URL("/movies/flixhq/", env.SFLIX_BASE_URL);

  private directProvider: DirectSflixProvider | null = null;
  private directFlixhqFeedProvider: DirectFlixhqFeedProvider | null = null;

  async search(query: string): Promise<SflixSearchResult[]> {
    if (this.isDirectMode) {
      const response = await this.getDirectProvider().search(query, 1);
      return searchResponseSchema.parse(response).results;
    }

    if (!this.baseUrl) {
      throw new Error("SFlix base URL is not configured.");
    }

    const url = new URL(encodeURIComponent(query), this.baseUrl);
    const response = await requestJson<unknown>(url);
    return searchResponseSchema.parse(response).results;
  }

  async getMediaInfo(id: string): Promise<SflixMediaInfo> {
    if (this.isDirectMode) {
      const response = await this.getDirectProvider().fetchMediaInfo(id);
      return mediaInfoSchema.parse(response);
    }

    const url = new URL("/movies/sflix/info", env.SFLIX_BASE_URL);
    const response = await requestJson<unknown>(url, {
      query: { id }
    });
    return mediaInfoSchema.parse(response);
  }

  async getHomeCatalog(): Promise<SflixHomeCatalog> {
    const response = this.isDirectMode
      ? await this.getDirectFlixhqFeedProvider().fetchHome()
      : await requestJson<unknown>(new URL("/movies/flixhq/home", this.requiredBaseUrl(this.flixhqBaseUrl)));

    if (isProviderErrorResponse(response)) {
      return this.buildHomeFallbackCatalog(response.error);
    }

    const parsed = homeCatalogResponseSchema.parse(response);
    const normalized = {
      featured: normalizeCatalogItems(parsed.featured),
      trendingMovies: normalizeCatalogItems(parsed.trending.Movies),
      recentMovieReleases: normalizeCatalogItems(parsed.recentReleases.Movies),
      upcoming: normalizeCatalogItems(parsed.upcoming)
    } satisfies SflixHomeCatalog;

    if (countHomeCatalogItems(normalized) === 0) {
      return this.buildHomeFallbackCatalog("Home feed returned no movie items");
    }

    return normalized;
  }

  async getPopularMoviesCatalog(page = 1): Promise<SflixPaginatedCatalog> {
    const response = this.isDirectMode
      ? await this.getDirectFlixhqFeedProvider().fetchPopularMovies(page)
      : await requestJson<unknown>(new URL("/movies/flixhq/popular-movies", this.requiredBaseUrl(this.flixhqBaseUrl)), {
          query: { page }
        });

    assertNotProviderError(response, "popular-movies");
    return normalizePaginatedCatalog(response);
  }

  async getTopMoviesCatalog(page = 1): Promise<SflixPaginatedCatalog> {
    const response = this.isDirectMode
      ? await this.getDirectFlixhqFeedProvider().fetchTopMovies(page)
      : await requestJson<unknown>(new URL("/movies/flixhq/top-movies", this.requiredBaseUrl(this.flixhqBaseUrl)), {
          query: { page }
        });

    assertNotProviderError(response, "top-movies");
    return normalizePaginatedCatalog(response);
  }

  private async buildHomeFallbackCatalog(reason: string): Promise<SflixHomeCatalog> {
    const [popular, top] = await Promise.all([
      this.getPopularMoviesCatalog(1),
      this.getTopMoviesCatalog(1)
    ]);

    const featured = dedupeCatalogItems([...popular.items.slice(0, 10), ...top.items.slice(0, 10)]);
    const recentMovieReleases = dedupeCatalogItems(popular.items);
    const trendingMovies = dedupeCatalogItems(top.items);

    if (featured.length === 0 && recentMovieReleases.length === 0 && trendingMovies.length === 0) {
      throw new Error(`Unable to build home feed fallback: ${reason}`);
    }

    return {
      featured,
      trendingMovies,
      recentMovieReleases,
      upcoming: []
    };
  }

  private getDirectProvider(): DirectSflixProvider {
    if (this.directProvider) {
      return this.directProvider;
    }

    const consumetRequire = createRequire(new URL("../../ConsumetAPI/package.json", import.meta.url));
    const { MOVIES } = consumetRequire("@consumet/extensions") as {
      MOVIES: {
        SFlix: new () => unknown;
      };
    };
    const { configureProvider } = consumetRequire("./dist/utils/provider.js") as {
      configureProvider: (provider: unknown) => DirectSflixProvider;
    };

    this.directProvider = configureProvider(new MOVIES.SFlix());
    return this.directProvider;
  }

  private getDirectFlixhqFeedProvider(): DirectFlixhqFeedProvider {
    if (this.directFlixhqFeedProvider) {
      return this.directFlixhqFeedProvider;
    }

    const consumetRequire = createRequire(new URL("../../ConsumetAPI/package.json", import.meta.url));

    try {
      const { FlixHQProvider } = consumetRequire("./dist/providers/custom/flixhqProvider.js") as {
        FlixHQProvider: DirectFlixhqFeedProvider;
      };
      this.directFlixhqFeedProvider = FlixHQProvider;
      return this.directFlixhqFeedProvider;
    } catch {
      const { FlixHQProvider } = consumetRequire("./src/providers/custom/flixhqProvider.ts") as {
        FlixHQProvider: DirectFlixhqFeedProvider;
      };
      this.directFlixhqFeedProvider = FlixHQProvider;
      return this.directFlixhqFeedProvider;
    }
  }

  private requiredBaseUrl(url: URL | null) {
    if (!url) {
      throw new Error("SFlix base URL is not configured.");
    }

    return url;
  }
}

function normalizePaginatedCatalog(response: unknown): SflixPaginatedCatalog {
  const parsed = paginatedCatalogResponseSchema.parse(response);

  return {
    items: normalizeCatalogItems(parsed.data),
    currentPage: parsed.currentPage ?? null,
    hasNextPage: parsed.hasNextPage ?? null,
    lastPage: parsed.lastPage ?? null
  };
}

function normalizeCatalogItems(items: Array<z.infer<typeof catalogItemSchema>>): SflixCatalogItem[] {
  const normalized: SflixCatalogItem[] = [];

  for (const item of items) {
    if (!item.id || !item.name) {
      continue;
    }

    normalized.push({
      id: item.id,
      title: item.name,
      image: item.posterImage ?? null,
      releaseDate: item.releaseDate == null ? null : String(item.releaseDate),
      type: item.type ?? "Movie"
    });
  }

  return normalized;
}

function dedupeCatalogItems(items: SflixCatalogItem[]) {
  const seen = new Set<string>();
  const deduped: SflixCatalogItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    deduped.push(item);
  }

  return deduped;
}

function countHomeCatalogItems(catalog: SflixHomeCatalog) {
  return (
    catalog.featured.length +
    catalog.trendingMovies.length +
    catalog.recentMovieReleases.length +
    catalog.upcoming.length
  );
}

function isProviderErrorResponse(response: unknown): response is z.infer<typeof providerErrorSchema> {
  return providerErrorSchema.safeParse(response).success;
}

function assertNotProviderError(response: unknown, feedName: string) {
  const parsed = providerErrorSchema.safeParse(response);

  if (parsed.success) {
    throw new Error(`Upstream ${feedName} feed error: ${parsed.data.error}`);
  }
}
