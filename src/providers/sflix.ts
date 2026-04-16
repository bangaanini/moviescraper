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

type DirectSflixProvider = {
  search: (query: string, page?: number) => Promise<unknown>;
  fetchMediaInfo: (id: string) => Promise<unknown>;
};

export class SflixClient {
  private readonly isDirectMode = env.SFLIX_BASE_URL.startsWith("local://");

  private readonly baseUrl = this.isDirectMode
    ? null
    : new URL("/movies/sflix/", env.SFLIX_BASE_URL);

  private directProvider: DirectSflixProvider | null = null;

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
}
