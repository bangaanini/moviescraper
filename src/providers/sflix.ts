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

const paginatedCatalogResponseSchema = z.object({
  currentPage: z.number().optional(),
  hasNextPage: z.boolean().optional(),
  lastPage: z.number().optional(),
  data: z.array(catalogItemSchema).default([])
});

const homeCatalogResponseSchema = z.object({
  featured: z.array(catalogItemSchema).default([]),
  trending: z.object({
    Movies: z.array(catalogItemSchema).default([]),
    Tv: z.array(catalogItemSchema).default([])
  }),
  recentReleases: z.object({
    Movies: z.array(catalogItemSchema).default([]),
    Tv: z.array(catalogItemSchema).default([])
  }),
  upcoming: z.array(catalogItemSchema).default([])
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

    const parsed = homeCatalogResponseSchema.parse(response);

    return {
      featured: normalizeCatalogItems(parsed.featured),
      trendingMovies: normalizeCatalogItems(parsed.trending.Movies),
      recentMovieReleases: normalizeCatalogItems(parsed.recentReleases.Movies),
      upcoming: normalizeCatalogItems(parsed.upcoming)
    };
  }

  async getPopularMoviesCatalog(page = 1): Promise<SflixPaginatedCatalog> {
    const response = this.isDirectMode
      ? await this.getDirectFlixhqFeedProvider().fetchPopularMovies(page)
      : await requestJson<unknown>(new URL("/movies/flixhq/popular-movies", this.requiredBaseUrl(this.flixhqBaseUrl)), {
          query: { page }
        });

    return normalizePaginatedCatalog(response);
  }

  async getTopMoviesCatalog(page = 1): Promise<SflixPaginatedCatalog> {
    const response = this.isDirectMode
      ? await this.getDirectFlixhqFeedProvider().fetchTopMovies(page)
      : await requestJson<unknown>(new URL("/movies/flixhq/top-movies", this.requiredBaseUrl(this.flixhqBaseUrl)), {
          query: { page }
        });

    return normalizePaginatedCatalog(response);
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
