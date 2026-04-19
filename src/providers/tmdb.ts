import { z } from "zod";

import { env } from "../config/env.js";
import { requestJson } from "../lib/http.js";

const searchResultSchema = z.object({
  id: z.number(),
  media_type: z.enum(["movie", "tv"]).optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  overview: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  vote_average: z.number().optional(),
  vote_count: z.number().optional(),
  popularity: z.number().optional(),
  adult: z.boolean().optional()
});

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema)
});

const paginatedMovieListItemSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  original_title: z.string().optional(),
  overview: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  vote_average: z.number().optional(),
  vote_count: z.number().optional(),
  popularity: z.number().optional(),
  adult: z.boolean().optional()
});

const paginatedMovieListResponseSchema = z.object({
  page: z.coerce.number(),
  total_pages: z.coerce.number().optional(),
  total_results: z.coerce.number().optional(),
  results: z.array(paginatedMovieListItemSchema).default([])
});

const seasonSchema = z.object({
  season_number: z.number(),
  name: z.string().optional(),
  overview: z.string().optional(),
  air_date: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  episode_count: z.number().nullable().optional()
});

const episodeSchema = z.object({
  episode_number: z.number(),
  season_number: z.number(),
  name: z.string(),
  overview: z.string().optional(),
  air_date: z.string().nullable().optional(),
  runtime: z.number().nullable().optional(),
  still_path: z.string().nullable().optional()
});

const movieDetailsSchema = z.object({
  id: z.number(),
  imdb_id: z.string().nullable().optional(),
  title: z.string(),
  original_title: z.string(),
  overview: z.string().optional(),
  original_language: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  runtime: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  popularity: z.number().optional(),
  vote_average: z.number().optional(),
  vote_count: z.number().optional(),
  adult: z.boolean().optional()
});

const tvDetailsSchema = z.object({
  id: z.number(),
  external_ids: z
    .object({
      imdb_id: z.string().nullable().optional()
    })
    .optional(),
  name: z.string(),
  original_name: z.string(),
  overview: z.string().optional(),
  original_language: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  popularity: z.number().optional(),
  vote_average: z.number().optional(),
  vote_count: z.number().optional(),
  seasons: z.array(seasonSchema).default([])
});

const seasonDetailsSchema = z.object({
  id: z.number(),
  season_number: z.number(),
  episodes: z.array(episodeSchema).default([])
});

export type CanonicalMediaType = "movie" | "tv";

export interface TmdbMatchInput {
  title: string;
  type: CanonicalMediaType;
  year?: number | undefined;
}

export interface TmdbMatch {
  id: number;
  type: CanonicalMediaType;
}

export interface TmdbMovieBundle {
  type: "movie";
  localized: z.infer<typeof movieDetailsSchema>;
  fallback: z.infer<typeof movieDetailsSchema>;
}

export interface TmdbTvBundle {
  type: "tv";
  localized: z.infer<typeof tvDetailsSchema>;
  fallback: z.infer<typeof tvDetailsSchema>;
  seasons: Array<z.infer<typeof seasonDetailsSchema>>;
}

export type TmdbBundle = TmdbMovieBundle | TmdbTvBundle;

export interface TmdbMovieFeedItem {
  id: number;
  title: string;
  originalTitle: string;
  overview: string | null;
  releaseDate: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
}

export interface TmdbPaginatedMovieFeed {
  page: number;
  totalPages: number | null;
  totalResults: number | null;
  items: TmdbMovieFeedItem[];
}

export interface TmdbHomeMovieFeed {
  featured: TmdbMovieFeedItem[];
  popular: TmdbMovieFeedItem[];
  upcoming: TmdbMovieFeedItem[];
}

export class TmdbClient {
  private readonly baseUrl = "https://api.themoviedb.org/3";

  async searchBestMatch(input: TmdbMatchInput): Promise<TmdbMatch | null> {
    const endpoint = input.type === "movie" ? "/search/movie" : "/search/tv";
    const response = await this.request<unknown>(endpoint, {
      query: {
        query: input.title,
        language: env.TMDB_DEFAULT_LANGUAGE,
        include_adult: false,
        ...(input.type === "movie"
          ? { year: input.year, primary_release_year: input.year }
          : { year: input.year, first_air_date_year: input.year })
      }
    });

    const parsed = searchResponseSchema.parse(response);
    const first = parsed.results[0];

    if (!first) {
      return null;
    }

    return {
      id: first.id,
      type: input.type
    };
  }

  async getBundle(match: TmdbMatch): Promise<TmdbBundle> {
    if (match.type === "movie") {
      const [localized, fallback] = await Promise.all([
        this.requestMovieDetails(match.id, env.TMDB_DEFAULT_LANGUAGE),
        this.requestMovieDetails(match.id, env.TMDB_FALLBACK_LANGUAGE)
      ]);

      return {
        type: "movie",
        localized,
        fallback
      };
    }

    const [localized, fallback] = await Promise.all([
      this.requestTvDetails(match.id, env.TMDB_DEFAULT_LANGUAGE),
      this.requestTvDetails(match.id, env.TMDB_FALLBACK_LANGUAGE)
    ]);

    const seasonNumbers = fallback.seasons
      .map((season) => season.season_number)
      .filter((seasonNumber) => seasonNumber >= 0);

    const seasons = await Promise.all(
      seasonNumbers.map((seasonNumber) =>
        this.requestSeasonDetails(match.id, seasonNumber, env.TMDB_DEFAULT_LANGUAGE)
      )
    );

    return {
      type: "tv",
      localized,
      fallback,
      seasons
    };
  }

  async getHomeMovieFeed(page = 1): Promise<TmdbHomeMovieFeed> {
    const [featured, popular, upcoming] = await Promise.all([
      this.requestMovieList("/trending/movie/day", page),
      this.requestMovieList("/movie/popular", page),
      this.requestMovieList("/movie/upcoming", page)
    ]);

    return {
      featured: featured.items,
      popular: popular.items,
      upcoming: upcoming.items
    };
  }

  async getPopularMoviesFeed(page = 1): Promise<TmdbPaginatedMovieFeed> {
    return this.requestMovieList("/movie/popular", page);
  }

  async getTopMoviesFeed(page = 1): Promise<TmdbPaginatedMovieFeed> {
    return this.requestMovieList("/movie/top_rated", page);
  }

  imageUrl(path: string | null | undefined): string | null {
    if (!path) {
      return null;
    }

    return `${env.TMDB_IMAGE_BASE_URL}${path}`;
  }

  private async requestMovieDetails(id: number, language: string) {
    const response = await this.request<unknown>(`/movie/${id}`, {
      query: { language }
    });
    return movieDetailsSchema.parse(response);
  }

  private async requestTvDetails(id: number, language: string) {
    const response = await this.request<unknown>(`/tv/${id}`, {
      query: {
        language,
        append_to_response: "external_ids"
      }
    });
    return tvDetailsSchema.parse(response);
  }

  private async requestSeasonDetails(seriesId: number, seasonNumber: number, language: string) {
    const response = await this.request<unknown>(`/tv/${seriesId}/season/${seasonNumber}`, {
      query: { language }
    });
    return seasonDetailsSchema.parse(response);
  }

  private async requestMovieList(path: string, page: number) {
    const response = await this.request<unknown>(path, {
      query: {
        language: env.TMDB_DEFAULT_LANGUAGE,
        page
      }
    });

    const parsed = paginatedMovieListResponseSchema.parse(response);

    return {
      page: parsed.page,
      totalPages: parsed.total_pages ?? null,
      totalResults: parsed.total_results ?? null,
      items: parsed.results.map((item) => ({
        id: item.id,
        title: item.title ?? item.original_title ?? String(item.id),
        originalTitle: item.original_title ?? item.title ?? String(item.id),
        overview: item.overview ?? null,
        releaseDate: item.release_date ?? null,
        posterPath: item.poster_path ?? null,
        backdropPath: item.backdrop_path ?? null,
        popularity: item.popularity ?? null,
        voteAverage: item.vote_average ?? null,
        voteCount: item.vote_count ?? null
      }))
    } satisfies TmdbPaginatedMovieFeed;
  }

  private async request<T>(
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined> } = {}
  ): Promise<T> {
    return requestJson<T>(`${this.baseUrl}${path}`, {
      headers: {
        authorization: `Bearer ${env.TMDB_API_TOKEN}`
      },
      ...(options.query ? { query: options.query } : {})
    });
  }
}
