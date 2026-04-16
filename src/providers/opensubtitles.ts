import { z } from "zod";

import { env } from "../config/env.js";
import { requestJson } from "../lib/http.js";

const subtitleFileSchema = z.object({
  file_id: z.union([z.string(), z.number()]).transform(String),
  file_name: z.string().optional()
});

const subtitleAttributesSchema = z.object({
  language: z.string().optional(),
  feature_details: z
    .object({
      title: z.string().optional(),
      year: z.number().nullable().optional(),
      movie_name: z.string().optional(),
      imdb_id: z.number().nullable().optional(),
      tmdb_id: z.number().nullable().optional(),
      season_number: z.number().nullable().optional(),
      episode_number: z.number().nullable().optional()
    })
    .optional(),
  release: z.string().optional(),
  hearing_impaired: z.boolean().optional(),
  ai_translated: z.boolean().optional(),
  download_count: z.number().optional(),
  ratings: z.number().optional(),
  files: z.array(subtitleFileSchema).default([])
});

const subtitleSearchItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  attributes: subtitleAttributesSchema
});

const subtitleSearchResponseSchema = z.object({
  data: z.array(subtitleSearchItemSchema).default([])
});

export type OpenSubtitlesSearchItem = z.infer<typeof subtitleSearchItemSchema>;

export interface SubtitleSearchInput {
  query: string;
  type: "movie" | "episode";
  year?: number | undefined;
  imdbId?: string | null | undefined;
  tmdbId?: number | null | undefined;
  seasonNumber?: number | undefined;
  episodeNumber?: number | undefined;
}

export class OpenSubtitlesClient {
  async searchIndonesianSubtitles(input: SubtitleSearchInput): Promise<OpenSubtitlesSearchItem[]> {
    if (!env.OPENSUBTITLES_API_KEY) {
      return [];
    }

    const response = await requestJson<unknown>(`${env.OPENSUBTITLES_API_BASE_URL}/subtitles`, {
      headers: {
        "api-key": env.OPENSUBTITLES_API_KEY,
        "user-agent": env.OPENSUBTITLES_USER_AGENT
      },
      query: {
        languages: env.OPENSUBTITLES_TARGET_LANGUAGE,
        query: input.query,
        type: input.type,
        year: input.year,
        imdb_id: normalizeImdbId(input.imdbId),
        tmdb_id: input.tmdbId ?? undefined,
        season_number: input.seasonNumber,
        episode_number: input.episodeNumber
      }
    });

    return subtitleSearchResponseSchema.parse(response).data;
  }
}

function normalizeImdbId(imdbId: string | null | undefined): string | undefined {
  if (!imdbId) {
    return undefined;
  }

  return imdbId.startsWith("tt") ? imdbId.slice(2) : imdbId;
}
