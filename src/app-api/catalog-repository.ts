import { prisma } from "../lib/prisma.js";
import { supabase } from "../lib/supabase.js";

type MediaType = "movie" | "tv";
type FeedKind = "home" | "popular-movies" | "top-movies";

type MediaRow = {
  id: number;
  public_id: string;
  media_type: MediaType;
  canonical_provider: string;
  canonical_external_id: string;
  original_title: string;
  original_overview: string | null;
  release_year: number | null;
  original_language: string | null;
  status: string | null;
  runtime_minutes: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  popularity: number | null;
  vote_average: number | null;
  vote_count: number | null;
  adult: boolean;
  metadata_source: string;
  subtitle_source: string | null;
  ingestion_confidence: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type LocalizationRow = {
  media_id: number;
  lang: string;
  title: string;
  overview: string | null;
  source_provider: string;
  source_kind: string;
  is_default: boolean;
  confidence: number | null;
};

type ExternalIdRow = {
  provider: string;
  external_id: string;
  external_url: string | null;
  is_primary: boolean;
};

type SeasonRow = {
  id: number;
  media_id: number;
  season_number: number;
  title: string | null;
  overview: string | null;
  air_date: string | null;
  poster_url: string | null;
  episode_count: number | null;
};

type EpisodeRow = {
  id: number;
  media_id: number;
  season_id: number | null;
  season_number: number;
  episode_number: number;
  title: string;
  overview: string | null;
  release_date: string | null;
  runtime_minutes: number | null;
  still_url: string | null;
};

type SubtitleTrackRow = {
  id: number;
  media_id: number | null;
  episode_id: number | null;
  provider: string;
  language_code: string;
  external_subtitle_id: string | null;
  external_file_id: string | null;
  release_name: string | null;
  file_name: string | null;
  format: string | null;
  is_hearing_impaired: boolean;
  is_ai_generated: boolean;
  source_kind: string;
  download_url: string | null;
  storage_path: string | null;
  download_status: string;
  score: number | null;
  downloads_count: number | null;
  updated_at: string;
};

type MediaFeedItemRow = {
  feed_kind: FeedKind;
  page_number: number;
  position: number;
  media_id: number;
  fetched_at: string;
};

export class CatalogRepository {
  async listMedia(input: {
    type?: MediaType;
    lang: string;
    limit: number;
    page: number;
    query?: string;
  }) {
    const from = (input.page - 1) * input.limit;
    const mediaRecords = await prisma.media.findMany({
      where: {
        isActive: true,
        ...(input.type ? { mediaType: input.type } : {}),
        ...(input.query
          ? {
              OR: [
                {
                  originalTitle: {
                    contains: input.query,
                    mode: "insensitive"
                  }
                },
                {
                  originalOverview: {
                    contains: input.query,
                    mode: "insensitive"
                  }
                },
                {
                  mediaLocalizations: {
                    some: {
                      lang: {
                        in: uniqueLangs(input.lang)
                      },
                      OR: [
                        {
                          title: {
                            contains: input.query,
                            mode: "insensitive"
                          }
                        },
                        {
                          overview: {
                            contains: input.query,
                            mode: "insensitive"
                          }
                        }
                      ]
                    }
                  }
                }
              ]
            }
          : {})
      },
      orderBy: {
        updatedAt: "desc"
      },
      skip: from,
      take: input.limit,
      select: {
        id: true,
        publicId: true,
        mediaType: true,
        canonicalProvider: true,
        canonicalExternalId: true,
        originalTitle: true,
        originalOverview: true,
        releaseYear: true,
        originalLanguage: true,
        status: true,
        runtimeMinutes: true,
        posterUrl: true,
        backdropUrl: true,
        popularity: true,
        voteAverage: true,
        voteCount: true,
        adult: true,
        metadataSource: true,
        subtitleSource: true,
        ingestionConfidence: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        mediaLocalizations: {
          where: {
            lang: {
              in: uniqueLangs(input.lang)
            }
          },
          select: {
            mediaId: true,
            lang: true,
            title: true,
            overview: true,
            sourceProvider: true,
            sourceKind: true,
            isDefault: true,
            confidence: true
          }
        }
      }
    });

    const mediaEntries = mediaRecords.map((record) => ({
      media: mapPrismaMediaRow(record),
      localization: pickLocalization(
        record.mediaLocalizations.map((localization) => mapPrismaLocalizationRow(localization)),
        input.lang
      )
    }));
    const subtitleCounts = await this.getMediaSubtitleCounts(
      mediaEntries.map((entry) => entry.media.id)
    );

    return {
      items: mediaEntries.map((entry) =>
        toMediaSummary(
          entry.media,
          entry.localization,
          subtitleCounts.get(entry.media.id) ?? 0
        )
      ),
      page: input.page,
      limit: input.limit
    };
  }

  async getMediaByPublicId(publicId: string, lang: string) {
    const { data, error } = await supabase
      .from("media")
      .select(
        "id, public_id, media_type, canonical_provider, canonical_external_id, original_title, original_overview, release_year, original_language, status, runtime_minutes, poster_url, backdrop_url, popularity, vote_average, vote_count, adult, metadata_source, subtitle_source, ingestion_confidence, is_active, created_at, updated_at"
      )
      .eq("public_id", publicId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    const media = data as MediaRow;
    const [localizations, externalIds, seasons, subtitles] = await Promise.all([
      this.getLocalizations(media.id, lang),
      this.getExternalIds(media.id),
      this.getSeasonsByMediaId(media.id),
      this.getMediaSubtitlesByMediaId(media.id, "id", 3)
    ]);

    return toMediaDetail(media, localizations, externalIds, seasons, subtitles, lang);
  }

  async getFeedPage(input: { feedKind: FeedKind; lang: string; page: number; limit: number }) {
    const { data, error } = await supabase
      .from("media_feed_items")
      .select("feed_kind, page_number, position, media_id, fetched_at")
      .eq("feed_kind", input.feedKind)
      .eq("page_number", input.page)
      .order("position", { ascending: true })
      .limit(input.limit);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as MediaFeedItemRow[];
    const summaryMap = await this.getMediaSummaryMap(
      rows.map((row) => row.media_id),
      input.lang
    );

    return {
      feed: input.feedKind,
      page: input.page,
      limit: input.limit,
      refreshedAt: rows.reduce<string | null>(
        (latest, row) => (latest == null || row.fetched_at > latest ? row.fetched_at : latest),
        null
      ),
      items: rows
        .map((row) => {
          const summary = summaryMap.get(row.media_id);
          if (!summary) {
            return null;
          }

          return {
            ...summary,
            feedPosition: row.position
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    };
  }

  async getSeasons(publicId: string) {
    const media = await this.getMediaIdentity(publicId);
    if (!media) {
      return [];
    }

    const seasons = await this.getSeasonsByMediaId(media.id);
    return seasons.map((season) => toSeason(season));
  }

  async getEpisodes(publicId: string, seasonNumber?: number) {
    const media = await this.getMediaIdentity(publicId);
    if (!media) {
      return [];
    }

    let query = supabase
      .from("episodes")
      .select(
        "id, media_id, season_id, season_number, episode_number, title, overview, release_date, runtime_minutes, still_url"
      )
      .eq("media_id", media.id)
      .order("season_number", { ascending: true })
      .order("episode_number", { ascending: true });

    if (seasonNumber !== undefined) {
      query = query.eq("season_number", seasonNumber);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const episodes = (data ?? []) as EpisodeRow[];
    const subtitleCounts = await this.getEpisodeSubtitleCounts(episodes.map((episode) => episode.id));

    return episodes.map((episode) => toEpisode(episode, subtitleCounts.get(episode.id) ?? 0));
  }

  async getMediaSubtitles(input: { publicId: string; languageCode: string; limit: number }) {
    const media = await this.getMediaIdentity(input.publicId);
    if (!media) {
      return [];
    }

    const subtitles = await this.getMediaSubtitlesByMediaId(media.id, input.languageCode, input.limit);
    return subtitles.map((subtitle, index) => toSubtitleTrack(subtitle, index));
  }

  async getEpisodeSubtitles(input: {
    publicId: string;
    seasonNumber: number;
    episodeNumber: number;
    languageCode: string;
    limit: number;
  }) {
    const media = await this.getMediaIdentity(input.publicId);
    if (!media) {
      return [];
    }

    const { data, error } = await supabase
      .from("episodes")
      .select("id")
      .eq("media_id", media.id)
      .eq("season_number", input.seasonNumber)
      .eq("episode_number", input.episodeNumber)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return [];
    }

    const subtitles = await this.getEpisodeSubtitlesByEpisodeId(
      (data as { id: number }).id,
      input.languageCode,
      input.limit
    );

    return subtitles.map((subtitle, index) => toSubtitleTrack(subtitle, index));
  }

  private async getMediaIdentity(publicId: string) {
    const { data, error } = await supabase
      .from("media")
      .select("id, public_id, media_type")
      .eq("public_id", publicId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as Pick<MediaRow, "id" | "public_id" | "media_type"> | null) ?? null;
  }

  private async getMediaSummaryMap(mediaIds: number[], lang: string) {
    const map = new Map<number, ReturnType<typeof toMediaSummary>>();

    if (mediaIds.length === 0) {
      return map;
    }

    const mediaRecords = await prisma.media.findMany({
      where: {
        id: {
          in: mediaIds.map((id) => BigInt(id))
        },
        isActive: true
      },
      select: {
        id: true,
        publicId: true,
        mediaType: true,
        canonicalProvider: true,
        canonicalExternalId: true,
        originalTitle: true,
        originalOverview: true,
        releaseYear: true,
        originalLanguage: true,
        status: true,
        runtimeMinutes: true,
        posterUrl: true,
        backdropUrl: true,
        popularity: true,
        voteAverage: true,
        voteCount: true,
        adult: true,
        metadataSource: true,
        subtitleSource: true,
        ingestionConfidence: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        mediaLocalizations: {
          where: {
            lang: {
              in: uniqueLangs(lang)
            }
          },
          select: {
            mediaId: true,
            lang: true,
            title: true,
            overview: true,
            sourceProvider: true,
            sourceKind: true,
            isDefault: true,
            confidence: true
          }
        }
      }
    });

    const subtitleCounts = await this.getMediaSubtitleCounts(
      mediaRecords.map((record) => Number(record.id))
    );

    for (const record of mediaRecords) {
      const media = mapPrismaMediaRow(record);
      const localization = pickLocalization(
        record.mediaLocalizations.map((item) => mapPrismaLocalizationRow(item)),
        lang
      );

      map.set(
        media.id,
        toMediaSummary(media, localization, subtitleCounts.get(media.id) ?? 0)
      );
    }

    return map;
  }

  private async getLocalizationMap(mediaIds: number[], lang: string) {
    const map = new Map<number, LocalizationRow | undefined>();

    if (mediaIds.length === 0) {
      return map;
    }

    const rows = await this.getLocalizationsByMediaIds(mediaIds, lang);
    const grouped = new Map<number, LocalizationRow[]>();

    for (const row of rows) {
      const current = grouped.get(row.media_id) ?? [];
      current.push(row);
      grouped.set(row.media_id, current);
    }

    for (const mediaId of mediaIds) {
      map.set(mediaId, pickLocalization(grouped.get(mediaId) ?? [], lang));
    }

    return map;
  }

  private async getLocalizations(mediaId: number, lang: string) {
    const { data, error } = await supabase
      .from("media_localizations")
      .select("media_id, lang, title, overview, source_provider, source_kind, is_default, confidence")
      .eq("media_id", mediaId)
      .in("lang", uniqueLangs(lang));

    if (error) {
      throw error;
    }

    return (data ?? []) as LocalizationRow[];
  }

  private async getLocalizationsByMediaIds(mediaIds: number[], lang: string) {
    const { data, error } = await supabase
      .from("media_localizations")
      .select("media_id, lang, title, overview, source_provider, source_kind, is_default, confidence")
      .in("media_id", mediaIds)
      .in("lang", uniqueLangs(lang));

    if (error) {
      throw error;
    }

    return (data ?? []) as LocalizationRow[];
  }

  private async getExternalIds(mediaId: number) {
    const { data, error } = await supabase
      .from("media_external_ids")
      .select("provider, external_id, external_url, is_primary")
      .eq("media_id", mediaId)
      .order("is_primary", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as ExternalIdRow[];
  }

  private async getSeasonsByMediaId(mediaId: number) {
    const { data, error } = await supabase
      .from("seasons")
      .select("id, media_id, season_number, title, overview, air_date, poster_url, episode_count")
      .eq("media_id", mediaId)
      .order("season_number", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as SeasonRow[];
  }

  private async getMediaSubtitlesByMediaId(mediaId: number, languageCode: string, limit: number) {
    const query = supabase
      .from("subtitle_tracks")
      .select(
        "id, media_id, episode_id, provider, language_code, external_subtitle_id, external_file_id, release_name, file_name, format, is_hearing_impaired, is_ai_generated, source_kind, download_url, storage_path, download_status, score, downloads_count, updated_at"
      )
      .eq("media_id", mediaId)
      .eq("language_code", languageCode)
      .order("score", { ascending: false, nullsFirst: false })
      .order("downloads_count", { ascending: false, nullsFirst: false });

    const limitedQuery = query.limit(limit);

    const { data: limitedData, error: limitedError } = await limitedQuery;

    if (limitedError) {
      throw limitedError;
    }

    return (limitedData ?? []) as SubtitleTrackRow[];
  }

  private async getEpisodeSubtitlesByEpisodeId(episodeId: number, languageCode: string, limit: number) {
    const query = supabase
      .from("subtitle_tracks")
      .select(
        "id, media_id, episode_id, provider, language_code, external_subtitle_id, external_file_id, release_name, file_name, format, is_hearing_impaired, is_ai_generated, source_kind, download_url, storage_path, download_status, score, downloads_count, updated_at"
      )
      .eq("episode_id", episodeId)
      .eq("language_code", languageCode)
      .order("score", { ascending: false, nullsFirst: false })
      .order("downloads_count", { ascending: false, nullsFirst: false })
      .limit(limit);

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data ?? []) as SubtitleTrackRow[];
  }

  private async getMediaSubtitleCounts(mediaIds: number[]) {
    const map = new Map<number, number>();

    if (mediaIds.length === 0) {
      return map;
    }

    const { data, error } = await supabase
      .from("subtitle_tracks")
      .select("media_id")
      .in("media_id", mediaIds)
      .eq("language_code", "id");

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as Array<{ media_id: number | null }>) {
      if (row.media_id == null) {
        continue;
      }

      map.set(row.media_id, (map.get(row.media_id) ?? 0) + 1);
    }

    return map;
  }

  private async getEpisodeSubtitleCounts(episodeIds: number[]) {
    const map = new Map<number, number>();

    if (episodeIds.length === 0) {
      return map;
    }

    const { data, error } = await supabase
      .from("subtitle_tracks")
      .select("episode_id")
      .in("episode_id", episodeIds)
      .eq("language_code", "id");

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as Array<{ episode_id: number | null }>) {
      if (row.episode_id == null) {
        continue;
      }

      map.set(row.episode_id, (map.get(row.episode_id) ?? 0) + 1);
    }

    return map;
  }
}

function uniqueLangs(lang: string) {
  return Array.from(new Set([normalizeLang(lang), "id", "en"]));
}

function normalizeLang(lang: string) {
  const value = lang.toLowerCase();

  if (value.startsWith("id")) {
    return "id";
  }

  if (value.startsWith("en")) {
    return "en";
  }

  return value;
}

function pickLocalization(rows: LocalizationRow[], lang: string) {
  const normalized = normalizeLang(lang);

  return (
    rows.find((row) => row.lang === normalized) ??
    rows.find((row) => row.lang === "id") ??
    rows.find((row) => row.lang === "en") ??
    rows.find((row) => row.is_default) ??
    rows[0]
  );
}

function toMediaSummary(media: MediaRow, localization: LocalizationRow | undefined, subtitleCount: number) {
  return {
    publicId: media.public_id,
    type: media.media_type,
    title: localization?.title ?? media.original_title,
    overview: localization?.overview ?? media.original_overview,
    originalTitle: media.original_title,
    releaseYear: media.release_year,
    runtimeMinutes: media.runtime_minutes,
    posterUrl: media.poster_url,
    backdropUrl: media.backdrop_url,
    popularity: media.popularity,
    voteAverage: media.vote_average,
    voteCount: media.vote_count,
    metadataSource: media.metadata_source,
    subtitleSource: media.subtitle_source,
    subtitleTrackCount: subtitleCount,
    localization: localization
      ? {
          lang: localization.lang,
          sourceProvider: localization.source_provider,
          sourceKind: localization.source_kind,
          confidence: localization.confidence
        }
      : null,
    updatedAt: media.updated_at
  };
}

function toMediaDetail(
  media: MediaRow,
  localizations: LocalizationRow[],
  externalIds: ExternalIdRow[],
  seasons: SeasonRow[],
  subtitles: SubtitleTrackRow[],
  lang: string
) {
  const preferredLocalization = pickLocalization(localizations, lang);

  return {
    publicId: media.public_id,
    type: media.media_type,
    title: preferredLocalization?.title ?? media.original_title,
    overview: preferredLocalization?.overview ?? media.original_overview,
    originalTitle: media.original_title,
    originalOverview: media.original_overview,
    releaseYear: media.release_year,
    originalLanguage: media.original_language,
    status: media.status,
    runtimeMinutes: media.runtime_minutes,
    posterUrl: media.poster_url,
    backdropUrl: media.backdrop_url,
    popularity: media.popularity,
    voteAverage: media.vote_average,
    voteCount: media.vote_count,
    adult: media.adult,
    metadataSource: media.metadata_source,
    subtitleSource: media.subtitle_source,
    ingestionConfidence: media.ingestion_confidence,
    externalIds: externalIds.map((row) => ({
      provider: row.provider,
      externalId: row.external_id,
      externalUrl: row.external_url,
      isPrimary: row.is_primary
    })),
    localizations: localizations.map((row) => ({
      lang: row.lang,
      title: row.title,
      overview: row.overview,
      sourceProvider: row.source_provider,
      sourceKind: row.source_kind,
      isDefault: row.is_default,
      confidence: row.confidence
    })),
    seasons: seasons.map((season) => toSeason(season)),
    subtitles: subtitles.map((subtitle, index) => toSubtitleTrack(subtitle, index)),
    updatedAt: media.updated_at
  };
}

function toSeason(season: SeasonRow) {
  return {
    seasonNumber: season.season_number,
    title: season.title,
    overview: season.overview,
    airDate: season.air_date,
    posterUrl: season.poster_url,
    episodeCount: season.episode_count
  };
}

function toEpisode(episode: EpisodeRow, subtitleCount: number) {
  return {
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    title: episode.title,
    overview: episode.overview,
    releaseDate: episode.release_date,
    runtimeMinutes: episode.runtime_minutes,
    stillUrl: episode.still_url,
    subtitleTrackCount: subtitleCount
  };
}

function toSubtitleTrack(subtitle: SubtitleTrackRow, index = 0) {
  return {
    rank: index + 1,
    isPreferred: index === 0,
    provider: subtitle.provider,
    languageCode: subtitle.language_code,
    externalSubtitleId: subtitle.external_subtitle_id,
    externalFileId: subtitle.external_file_id,
    releaseName: subtitle.release_name,
    fileName: subtitle.file_name,
    format: subtitle.format,
    isHearingImpaired: subtitle.is_hearing_impaired,
    isAiGenerated: subtitle.is_ai_generated,
    sourceKind: subtitle.source_kind,
    downloadUrl: subtitle.download_url,
    storagePath: subtitle.storage_path,
    downloadStatus: subtitle.download_status,
    score: subtitle.score,
    downloadsCount: subtitle.downloads_count,
    updatedAt: subtitle.updated_at
  };
}

function mapPrismaMediaRow(record: {
  id: bigint;
  publicId: string;
  mediaType: MediaType;
  canonicalProvider: string;
  canonicalExternalId: string;
  originalTitle: string;
  originalOverview: string | null;
  releaseYear: number | null;
  originalLanguage: string | null;
  status: string | null;
  runtimeMinutes: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  popularity: DecimalLike | null;
  voteAverage: DecimalLike | null;
  voteCount: number | null;
  adult: boolean;
  metadataSource: string;
  subtitleSource: string | null;
  ingestionConfidence: DecimalLike | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: Number(record.id),
    public_id: record.publicId,
    media_type: record.mediaType,
    canonical_provider: record.canonicalProvider,
    canonical_external_id: record.canonicalExternalId,
    original_title: record.originalTitle,
    original_overview: record.originalOverview,
    release_year: record.releaseYear,
    original_language: record.originalLanguage,
    status: record.status,
    runtime_minutes: record.runtimeMinutes,
    poster_url: record.posterUrl,
    backdrop_url: record.backdropUrl,
    popularity: decimalToNumber(record.popularity),
    vote_average: decimalToNumber(record.voteAverage),
    vote_count: record.voteCount,
    adult: record.adult,
    metadata_source: record.metadataSource,
    subtitle_source: record.subtitleSource,
    ingestion_confidence: decimalToNumber(record.ingestionConfidence),
    is_active: record.isActive,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString()
  } satisfies MediaRow;
}

function mapPrismaLocalizationRow(record: {
  mediaId: bigint;
  lang: string;
  title: string;
  overview: string | null;
  sourceProvider: string;
  sourceKind: string;
  isDefault: boolean;
  confidence: DecimalLike | null;
}) {
  return {
    media_id: Number(record.mediaId),
    lang: record.lang,
    title: record.title,
    overview: record.overview,
    source_provider: record.sourceProvider,
    source_kind: record.sourceKind,
    is_default: record.isDefault,
    confidence: decimalToNumber(record.confidence)
  } satisfies LocalizationRow;
}

type DecimalLike = {
  toNumber(): number;
};

function decimalToNumber(value: DecimalLike | null) {
  return value ? value.toNumber() : null;
}
