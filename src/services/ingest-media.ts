import type { OpenSubtitlesSearchItem } from "../providers/opensubtitles.js";
import type { SflixMediaInfo, SflixSearchResult } from "../providers/sflix.js";
import type { TmdbBundle, TmdbMatch, TmdbMovieFeedItem } from "../providers/tmdb.js";
import { OpenSubtitlesClient } from "../providers/opensubtitles.js";
import { SflixClient } from "../providers/sflix.js";
import { TmdbClient } from "../providers/tmdb.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";

interface IngestMediaInput {
  query: string;
  limit: number;
}

type FeedKind = "home" | "popular-movies" | "top-movies";

interface InsertedMediaRow {
  id: number;
  media_type: "movie" | "tv";
}

export class MediaIngestService {
  private readonly sflix = new SflixClient();
  private readonly tmdb = new TmdbClient();
  private readonly openSubtitles = new OpenSubtitlesClient();

  async ingestByQuery(input: IngestMediaInput): Promise<void> {
    const results = await this.sflix.search(input.query);
    const slice = results.slice(0, input.limit);

    logger.info({ query: input.query, count: slice.length }, "Fetched SFlix search results");

    await this.ingestProviderIds(
      slice.map((result) => result.id),
      { source: "search", query: input.query }
    );
  }

  async ingestHome(input: { page?: number; limit?: number; offset?: number } = {}): Promise<void> {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? ((input.page ?? 1) - 1) * limit;

    if (offset % limit !== 0) {
      throw new Error("Home ingest offset must be a multiple of limit");
    }

    const pageNumber = Math.floor(offset / limit) + 1;
    const home = await this.tmdb.getHomeMovieFeed(pageNumber);
    const candidates = dedupeTmdbMovieFeedItems([
      ...home.featured,
      ...home.popular,
      ...home.upcoming
    ]);
    const slice = input.offset !== undefined ? candidates.slice(offset, offset + limit) : candidates.slice(0, limit);

    logger.info(
      {
        source: "home",
        page: pageNumber,
        limit,
        offset,
        totalMovieCount: candidates.length,
        ingestCount: slice.length,
        featuredCount: home.featured.length,
        popularMovieCount: home.popular.length,
        upcomingMovieCount: home.upcoming.length
      },
      "Fetched TMDb home feed"
    );

    await this.ingestTmdbFeedItems(slice, {
      feedKind: "home",
      pageNumber
    });
  }

  async ingestPopularMovies(input: { page?: number; limit?: number } = {}): Promise<void> {
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const feed = await this.tmdb.getPopularMoviesFeed(page);
    const slice = feed.items.slice(0, limit);

    logger.info(
      {
        source: "popular-movies",
        page,
        limit,
        fetchedCount: feed.items.length,
        ingestCount: slice.length,
        totalPages: feed.totalPages,
        totalResults: feed.totalResults
      },
      "Fetched TMDb feed results"
    );

    await this.ingestTmdbFeedItems(slice, {
      feedKind: "popular-movies",
      pageNumber: page
    });
  }

  async ingestTopMovies(input: { page?: number; limit?: number } = {}): Promise<void> {
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const feed = await this.tmdb.getTopMoviesFeed(page);
    const slice = feed.items.slice(0, limit);

    logger.info(
      {
        source: "top-movies",
        page,
        limit,
        fetchedCount: feed.items.length,
        ingestCount: slice.length,
        totalPages: feed.totalPages,
        totalResults: feed.totalResults
      },
      "Fetched TMDb feed results"
    );

    await this.ingestTmdbFeedItems(slice, {
      feedKind: "top-movies",
      pageNumber: page
    });
  }

  private async ingestTmdbFeedItems(
    items: TmdbMovieFeedItem[],
    context: { feedKind: FeedKind; pageNumber: number }
  ) {
    const successes = await this.ingestOrderedTmdbFeedItems(
      items.map((item, index) => ({
        item,
        position: index + 1
      })),
      {
      source: context.feedKind,
      page: context.pageNumber
    });

    await this.replaceFeedPage(context.feedKind, context.pageNumber, successes);
  }

  private async ingestProviderIds(
    ids: string[],
    context: {
      source: string;
      query?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const dedupedIds = Array.from(new Set(ids.filter((id) => id.trim().length > 0)));
    const slice = context.limit ? dedupedIds.slice(0, context.limit) : dedupedIds;

    logger.info(
      {
        source: context.source,
        query: context.query,
        page: context.page,
        fetchedCount: ids.length,
        uniqueCount: dedupedIds.length,
        ingestCount: slice.length
      },
      "Prepared SFlix items for ingestion"
    );

    await this.ingestOrderedProviderIds(
      slice.map((id, index) => ({ id, position: index + 1 })),
      context
    );
  }

  private async ingestOrderedProviderIds(
    items: Array<{ id: string; position: number }>,
    context: { source: string; query?: string; page?: number }
  ) {
    const successes: Array<{ mediaId: number; sourceExternalId: string; position: number }> = [];

    for (const item of items) {
      try {
        const mediaRow = await this.ingestProviderId(item.id);
        successes.push({
          mediaId: mediaRow.id,
          sourceExternalId: item.id,
          position: item.position
        });
      } catch (error) {
        logger.error(
          {
            source: context.source,
            query: context.query,
            page: context.page,
            providerId: item.id,
            err: error
          },
          "Media ingest failed for feed item"
        );
      }
    }

    logger.info(
      {
        source: context.source,
        query: context.query,
        page: context.page,
        attemptedCount: items.length,
        succeededCount: successes.length,
        failedCount: items.length - successes.length
      },
      "Completed media ingestion batch"
    );

    return successes;
  }

  private async ingestOrderedTmdbFeedItems(
    items: Array<{ item: TmdbMovieFeedItem; position: number }>,
    context: { source: string; page?: number }
  ) {
    const successes: Array<{
      mediaId: number;
      sourceExternalId: string;
      sourceProvider: string;
      position: number;
    }> = [];

    for (const entry of items) {
      try {
        const providerId = await this.resolveSflixProviderIdForTmdbMovie(entry.item);

        if (!providerId) {
          logger.warn(
            {
              source: context.source,
              page: context.page,
              tmdbId: entry.item.id,
              title: entry.item.title,
              originalTitle: entry.item.originalTitle
            },
            "No matching SFlix result found for TMDb movie"
          );
          continue;
        }

        const mediaRow = await this.ingestProviderId(providerId);
        successes.push({
          mediaId: mediaRow.id,
          sourceExternalId: String(entry.item.id),
          sourceProvider: "tmdb",
          position: entry.position
        });
      } catch (error) {
        logger.error(
          {
            source: context.source,
            page: context.page,
            tmdbId: entry.item.id,
            title: entry.item.title,
            err: error
          },
          "TMDb feed item ingest failed"
        );
      }
    }

    logger.info(
      {
        source: context.source,
        page: context.page,
        attemptedCount: items.length,
        succeededCount: successes.length,
        failedCount: items.length - successes.length
      },
      "Completed TMDb feed ingestion batch"
    );

    return successes;
  }

  private async ingestProviderId(id: string): Promise<InsertedMediaRow> {
    const mediaInfo = await this.sflix.getMediaInfo(id);
    const mediaType = normalizeMediaType(mediaInfo.type);
    const year = extractYear(mediaInfo.releaseDate);
    const { tmdbMatch, tmdbBundle } = await this.tryResolveTmdb(mediaInfo.title, mediaType, year);

    const mediaRow = await this.upsertMedia(mediaInfo, tmdbMatch, tmdbBundle);
    await this.upsertExternalIds(mediaRow.id, mediaInfo, tmdbBundle);
    await this.upsertLocalizations(mediaRow.id, mediaInfo, tmdbBundle);

    if (tmdbBundle?.type === "tv") {
      await this.upsertSeasonsAndEpisodes(mediaRow.id, mediaInfo, tmdbBundle);
    }

    await this.discoverSubtitleTracksSafely(mediaRow, mediaInfo, tmdbBundle);

    logger.info(
      {
        mediaId: mediaRow.id,
        title: mediaInfo.title,
        canonicalProvider: tmdbMatch ? "tmdb" : "sflix"
      },
      "Media ingested"
    );

    return mediaRow;
  }

  private async replaceFeedPage(
    feedKind: FeedKind,
    pageNumber: number,
    items: Array<{
      mediaId: number;
      sourceExternalId: string;
      sourceProvider: string;
      position: number;
    }>
  ) {
    if (items.length === 0) {
      logger.warn({ feedKind, pageNumber }, "Skipping feed page replacement because no items were ingested");
      return;
    }

    const { error: deleteError } = await supabase
      .from("media_feed_items")
      .delete()
      .eq("feed_kind", feedKind)
      .eq("page_number", pageNumber);

    if (deleteError) {
      throw deleteError;
    }

    const fetchedAt = new Date().toISOString();
    const rows = items.map((item) => ({
      feed_kind: feedKind,
      page_number: pageNumber,
      position: item.position,
      media_id: item.mediaId,
      source_provider: item.sourceProvider,
      source_external_id: item.sourceExternalId,
      fetched_at: fetchedAt
    }));

    const { error: insertError } = await supabase.from("media_feed_items").insert(rows);

    if (insertError) {
      throw insertError;
    }

    logger.info({ feedKind, pageNumber, count: rows.length }, "Feed page stored");
  }

  private async resolveSflixProviderIdForTmdbMovie(item: TmdbMovieFeedItem) {
    const queryCandidates = uniqueNonEmptyStrings([item.originalTitle, item.title]);

    for (const query of queryCandidates) {
      const results = await this.sflix.search(query);
      const match = await this.findMatchingSflixResultForTmdbMovie(results.slice(0, 5), item);

      if (match) {
        return match.id;
      }
    }

    return null;
  }

  private async findMatchingSflixResultForTmdbMovie(
    results: SflixSearchResult[],
    item: TmdbMovieFeedItem
  ) {
    for (const result of results) {
      if (normalizeMediaType(result.type) !== "movie") {
        continue;
      }

      try {
        const mediaInfo = await this.sflix.getMediaInfo(result.id);
        const mediaType = normalizeMediaType(mediaInfo.type);

        if (mediaType !== "movie") {
          continue;
        }

        const year = extractYear(mediaInfo.releaseDate);
        const { tmdbMatch } = await this.tryResolveTmdb(mediaInfo.title, mediaType, year);

        if (tmdbMatch?.type === "movie" && tmdbMatch.id === item.id) {
          return result;
        }
      } catch (error) {
        logger.warn(
          {
            tmdbId: item.id,
            sflixId: result.id,
            title: result.title,
            err: error
          },
          "SFlix candidate match evaluation failed"
        );
      }
    }

    return null;
  }

  private async tryResolveTmdb(
    title: string,
    type: "movie" | "tv",
    year: number | undefined
  ): Promise<{ tmdbMatch: TmdbMatch | null; tmdbBundle: TmdbBundle | null }> {
    try {
      const tmdbMatch = await this.tmdb.searchBestMatch({
        title,
        type,
        ...(year ? { year } : {})
      });

      const tmdbBundle = tmdbMatch ? await this.tmdb.getBundle(tmdbMatch) : null;
      return { tmdbMatch, tmdbBundle };
    } catch (error) {
      logger.warn(
        {
          title,
          type,
          year,
          err: error
        },
        "TMDb enrichment failed, continuing with SFlix-only data"
      );

      return {
        tmdbMatch: null,
        tmdbBundle: null
      };
    }
  }

  private async discoverSubtitleTracksSafely(
    media: InsertedMediaRow,
    mediaInfo: SflixMediaInfo,
    tmdbBundle: TmdbBundle | null
  ): Promise<void> {
    try {
      await this.discoverSubtitleTracks(media, mediaInfo, tmdbBundle);
    } catch (error) {
      logger.warn(
        {
          mediaId: media.id,
          title: mediaInfo.title,
          err: error
        },
        "Subtitle discovery failed, continuing without subtitle tracks"
      );
    }
  }

  private async upsertMedia(
    mediaInfo: SflixMediaInfo,
    tmdbMatch: TmdbMatch | null,
    tmdbBundle: TmdbBundle | null
  ): Promise<InsertedMediaRow> {
    const mediaType = normalizeMediaType(mediaInfo.type);
    const canonicalProvider = tmdbMatch ? "tmdb" : "sflix";
    const canonicalExternalId = tmdbMatch ? String(tmdbMatch.id) : mediaInfo.id;

    const localizedTitle =
      tmdbBundle?.type === "movie"
        ? tmdbBundle.localized.title
        : tmdbBundle?.type === "tv"
          ? tmdbBundle.localized.name
          : mediaInfo.title;

    const fallbackTitle =
      tmdbBundle?.type === "movie"
        ? tmdbBundle.fallback.original_title
        : tmdbBundle?.type === "tv"
          ? tmdbBundle.fallback.original_name
          : mediaInfo.title;

    const originalOverview =
      tmdbBundle?.type === "movie"
        ? tmdbBundle.fallback.overview
        : tmdbBundle?.type === "tv"
          ? tmdbBundle.fallback.overview
          : mediaInfo.description;

    const posterUrl =
      tmdbBundle?.type === "movie"
        ? this.tmdb.imageUrl(tmdbBundle.localized.poster_path)
        : tmdbBundle?.type === "tv"
          ? this.tmdb.imageUrl(tmdbBundle.localized.poster_path)
          : mediaInfo.image ?? null;

    const backdropUrl =
      tmdbBundle?.type === "movie"
        ? this.tmdb.imageUrl(tmdbBundle.localized.backdrop_path)
        : tmdbBundle?.type === "tv"
          ? this.tmdb.imageUrl(tmdbBundle.localized.backdrop_path)
          : null;

    const row = {
      media_type: mediaType,
      canonical_provider: canonicalProvider,
      canonical_external_id: canonicalExternalId,
      original_title: fallbackTitle || localizedTitle,
      original_overview: originalOverview ?? null,
      release_year: extractYear(
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.release_date
          : tmdbBundle?.type === "tv"
            ? tmdbBundle.localized.first_air_date
            : mediaInfo.releaseDate
      ),
      original_language:
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.original_language ?? null
          : tmdbBundle?.type === "tv"
            ? tmdbBundle.localized.original_language ?? null
            : null,
      status:
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.status ?? null
          : tmdbBundle?.type === "tv"
            ? tmdbBundle.localized.status ?? null
            : null,
      runtime_minutes:
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.runtime ?? null
          : null,
      poster_url: posterUrl,
      backdrop_url: backdropUrl,
      popularity:
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.popularity ?? null
          : tmdbBundle?.type === "tv"
            ? tmdbBundle.localized.popularity ?? null
            : null,
      vote_average:
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.vote_average ?? null
          : tmdbBundle?.type === "tv"
            ? tmdbBundle.localized.vote_average ?? null
            : null,
      vote_count:
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.vote_count ?? null
          : tmdbBundle?.type === "tv"
            ? tmdbBundle.localized.vote_count ?? null
            : null,
      adult:
        tmdbBundle?.type === "movie"
          ? tmdbBundle.localized.adult ?? false
          : false,
      metadata_source: tmdbBundle ? "tmdb" : "sflix",
      subtitle_source: "opensubtitles",
      ingestion_confidence: tmdbBundle ? 0.95 : 0.55
    };

    const { data, error } = await supabase
      .from("media")
      .upsert(row, {
        onConflict: "canonical_provider,canonical_external_id"
      })
      .select("id, media_type")
      .single();

    if (error) {
      throw error;
    }

    return data as InsertedMediaRow;
  }

  private async upsertExternalIds(
    mediaId: number,
    mediaInfo: SflixMediaInfo,
    tmdbBundle: TmdbBundle | null
  ): Promise<void> {
    const rows: Array<Record<string, unknown>> = [
      {
        media_id: mediaId,
        provider: "sflix",
        external_id: mediaInfo.id,
        external_url: mediaInfo.url,
        is_primary: !tmdbBundle,
        raw_payload: mediaInfo
      }
    ];

    if (tmdbBundle?.type === "movie") {
      rows.push({
        media_id: mediaId,
        provider: "tmdb",
        external_id: String(tmdbBundle.localized.id),
        external_url: `https://www.themoviedb.org/movie/${tmdbBundle.localized.id}`,
        is_primary: true,
        raw_payload: tmdbBundle.localized
      });

      if (tmdbBundle.localized.imdb_id) {
        rows.push({
          media_id: mediaId,
          provider: "imdb",
          external_id: tmdbBundle.localized.imdb_id,
          external_url: `https://www.imdb.com/title/${tmdbBundle.localized.imdb_id}`,
          is_primary: false,
          raw_payload: { imdb_id: tmdbBundle.localized.imdb_id }
        });
      }
    }

    if (tmdbBundle?.type === "tv") {
      rows.push({
        media_id: mediaId,
        provider: "tmdb",
        external_id: String(tmdbBundle.localized.id),
        external_url: `https://www.themoviedb.org/tv/${tmdbBundle.localized.id}`,
        is_primary: true,
        raw_payload: tmdbBundle.localized
      });

      const imdbId = tmdbBundle.localized.external_ids?.imdb_id;
      if (imdbId) {
        rows.push({
          media_id: mediaId,
          provider: "imdb",
          external_id: imdbId,
          external_url: `https://www.imdb.com/title/${imdbId}`,
          is_primary: false,
          raw_payload: { imdb_id: imdbId }
        });
      }
    }

    const { error } = await supabase.from("media_external_ids").upsert(rows, {
      onConflict: "provider,external_id"
    });

    if (error) {
      throw error;
    }
  }

  private async upsertLocalizations(
    mediaId: number,
    mediaInfo: SflixMediaInfo,
    tmdbBundle: TmdbBundle | null
  ): Promise<void> {
    const rows: Array<Record<string, unknown>> = [];

    if (!tmdbBundle) {
      rows.push({
        media_id: mediaId,
        lang: "en",
        title: mediaInfo.title,
        overview: mediaInfo.description ?? null,
        source_provider: "sflix",
        source_kind: "fallback",
        is_default: true,
        confidence: 0.6
      });
    }

    if (tmdbBundle?.type === "movie") {
      rows.push({
        media_id: mediaId,
        lang: "id",
        title: tmdbBundle.localized.title,
        overview: tmdbBundle.localized.overview ?? null,
        source_provider: "tmdb",
        source_kind: "localized",
        is_default: true,
        confidence: 0.95
      });

      rows.push({
        media_id: mediaId,
        lang: "en",
        title: tmdbBundle.fallback.title,
        overview: tmdbBundle.fallback.overview ?? null,
        source_provider: "tmdb",
        source_kind: "fallback",
        is_default: false,
        confidence: 0.9
      });
    }

    if (tmdbBundle?.type === "tv") {
      rows.push({
        media_id: mediaId,
        lang: "id",
        title: tmdbBundle.localized.name,
        overview: tmdbBundle.localized.overview ?? null,
        source_provider: "tmdb",
        source_kind: "localized",
        is_default: true,
        confidence: 0.95
      });

      rows.push({
        media_id: mediaId,
        lang: "en",
        title: tmdbBundle.fallback.name,
        overview: tmdbBundle.fallback.overview ?? null,
        source_provider: "tmdb",
        source_kind: "fallback",
        is_default: false,
        confidence: 0.9
      });
    }

    const { error } = await supabase.from("media_localizations").upsert(rows, {
      onConflict: "media_id,lang"
    });

    if (error) {
      throw error;
    }
  }

  private async upsertSeasonsAndEpisodes(
    mediaId: number,
    mediaInfo: SflixMediaInfo,
    tmdbBundle: Extract<TmdbBundle, { type: "tv" }>
  ): Promise<void> {
    const seasonRows = tmdbBundle.seasons.map((season) => {
      const seasonMeta = tmdbBundle.localized.seasons.find(
        (candidate) => candidate.season_number === season.season_number
      );

      return {
        media_id: mediaId,
        season_number: season.season_number,
        title: seasonMeta?.name ?? `Season ${season.season_number}`,
        overview: seasonMeta?.overview ?? null,
        air_date: seasonMeta?.air_date ?? null,
        poster_url: this.tmdb.imageUrl(seasonMeta?.poster_path),
        episode_count: seasonMeta?.episode_count ?? season.episodes.length
      };
    });

    if (seasonRows.length > 0) {
      const { error } = await supabase.from("seasons").upsert(seasonRows, {
        onConflict: "media_id,season_number"
      });

      if (error) {
        throw error;
      }
    }

    const { data: seasons, error: seasonsError } = await supabase
      .from("seasons")
      .select("id, season_number")
      .eq("media_id", mediaId);

    if (seasonsError) {
      throw seasonsError;
    }

    const seasonMap = new Map<number, number>(
      (seasons ?? []).map((season) => [season.season_number as number, season.id as number])
    );

    const validEpisodes = mediaInfo.episodes.filter(
      (
        episode
      ): episode is typeof episode & {
        season: number;
        number: number;
      } => typeof episode.season === "number" && typeof episode.number === "number"
    );

    const episodeRows = validEpisodes.map((episode) => {
      const tmdbSeason = tmdbBundle.seasons.find((season) => season.season_number === episode.season);
      const tmdbEpisode = tmdbSeason?.episodes.find(
        (candidate) => candidate.episode_number === episode.number
      );

      return {
        media_id: mediaId,
        season_id: seasonMap.get(episode.season) ?? null,
        season_number: episode.season,
        episode_number: episode.number,
        title: tmdbEpisode?.name ?? episode.title,
        overview: tmdbEpisode?.overview ?? null,
        release_date: tmdbEpisode?.air_date ?? null,
        runtime_minutes: tmdbEpisode?.runtime ?? null,
        still_url: this.tmdb.imageUrl(tmdbEpisode?.still_path)
      };
    });

    if (episodeRows.length > 0) {
      const { error } = await supabase.from("episodes").upsert(episodeRows, {
        onConflict: "media_id,season_number,episode_number"
      });

      if (error) {
        throw error;
      }
    }

    const { data: episodes, error: episodesError } = await supabase
      .from("episodes")
      .select("id, season_number, episode_number")
      .eq("media_id", mediaId);

    if (episodesError) {
      throw episodesError;
    }

    const episodeKeyMap = new Map<string, number>(
      (episodes ?? []).map((episode) => [
        `${episode.season_number as number}:${episode.episode_number as number}`,
        episode.id as number
      ])
    );

    const externalRows = validEpisodes.map((episode) => ({
      episode_id: episodeKeyMap.get(`${episode.season}:${episode.number}`),
      provider: "sflix",
      external_id: episode.id,
      external_url: episode.url ?? null,
      raw_payload: episode
    }));

    const filteredRows = externalRows.filter(
      (row): row is typeof row & { episode_id: number } => typeof row.episode_id === "number"
    );

    if (filteredRows.length > 0) {
      const { error } = await supabase.from("episode_external_ids").upsert(filteredRows, {
        onConflict: "provider,external_id"
      });

      if (error) {
        throw error;
      }
    }
  }

  private async discoverSubtitleTracks(
    media: InsertedMediaRow,
    mediaInfo: SflixMediaInfo,
    tmdbBundle: TmdbBundle | null
  ): Promise<void> {
    const imdbId =
      tmdbBundle?.type === "movie"
        ? tmdbBundle.localized.imdb_id ?? null
        : tmdbBundle?.type === "tv"
          ? tmdbBundle.localized.external_ids?.imdb_id ?? null
          : null;

    const tmdbId = tmdbBundle?.localized.id ?? null;

    if (media.media_type === "movie") {
      const releaseYear = extractYear(mediaInfo.releaseDate);
      const subtitles = rankSubtitleMatches({
        subtitles: await this.openSubtitles.searchIndonesianSubtitles({
        query: mediaInfo.title,
        type: "movie",
        imdbId,
        tmdbId,
        year: releaseYear
        }),
        titles: collectPreferredTitles(mediaInfo, tmdbBundle),
        type: "movie",
        ...(imdbId ? { imdbId } : {}),
        ...(tmdbId != null ? { tmdbId } : {}),
        ...(releaseYear !== undefined ? { year: releaseYear } : {})
      });

      await this.persistSubtitleTracks({
        mediaId: media.id,
        subtitles
      });

      return;
    }

    const { data: episodes, error } = await supabase
      .from("episodes")
      .select("id, season_number, episode_number, title")
      .eq("media_id", media.id);

    if (error) {
      throw error;
    }

    for (const episode of episodes ?? []) {
      const seasonNumber = episode.season_number as number;
      const episodeNumber = episode.episode_number as number;
      const subtitles = rankSubtitleMatches({
        subtitles: await this.openSubtitles.searchIndonesianSubtitles({
        query: `${mediaInfo.title} ${episode.title as string}`,
        type: "episode",
        imdbId,
        tmdbId,
        seasonNumber,
        episodeNumber
        }),
        titles: collectPreferredTitles(mediaInfo, tmdbBundle),
        type: "episode",
        ...(imdbId ? { imdbId } : {}),
        ...(tmdbId != null ? { tmdbId } : {}),
        seasonNumber,
        episodeNumber
      });

      await this.persistSubtitleTracks({
        episodeId: episode.id as number,
        subtitles
      });
    }
  }

  private async persistSubtitleTracks(input: {
    mediaId?: number;
    episodeId?: number;
    subtitles: RankedSubtitleMatch[];
  }): Promise<void> {
    const rows = dedupeSubtitleRows(
      input.subtitles.flatMap((subtitle) =>
      subtitle.item.attributes.files.map((file) => ({
        media_id: input.mediaId ?? null,
        episode_id: input.episodeId ?? null,
        provider: "opensubtitles",
        language_code: "id",
        external_subtitle_id: subtitle.item.id,
        external_file_id: file.file_id,
        release_name: subtitle.item.attributes.release ?? null,
        file_name: file.file_name ?? null,
        format: getFileExtension(file.file_name),
        is_hearing_impaired: subtitle.item.attributes.hearing_impaired ?? false,
        is_ai_generated: subtitle.item.attributes.ai_translated ?? false,
        source_kind: "discovered",
        download_status: "discovered",
        score: subtitle.rankScore,
        downloads_count: subtitle.item.attributes.download_count ?? null,
        raw_payload: subtitle.item
      }))
      )
    );

    await this.clearExistingSubtitleTracks(input);

    if (rows.length === 0) {
      return;
    }

    const { error } = await supabase.from("subtitle_tracks").upsert(rows, {
      onConflict: "provider,external_file_id"
    });

    if (error) {
      throw error;
    }
  }

  private async clearExistingSubtitleTracks(input: { mediaId?: number; episodeId?: number }) {
    let query = supabase
      .from("subtitle_tracks")
      .delete()
      .eq("provider", "opensubtitles")
      .eq("source_kind", "discovered");

    if (input.mediaId !== undefined) {
      query = query.eq("media_id", input.mediaId).is("episode_id", null);
    } else if (input.episodeId !== undefined) {
      query = query.eq("episode_id", input.episodeId).is("media_id", null);
    } else {
      return;
    }

    const { error } = await query;

    if (error) {
      throw error;
    }
  }
}

function dedupeTmdbMovieFeedItems(items: TmdbMovieFeedItem[]) {
  const seen = new Set<number>();
  const deduped: TmdbMovieFeedItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    deduped.push(item);
  }

  return deduped;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))
  );
}

function normalizeMediaType(type: string): "movie" | "tv" {
  return type.toLowerCase() === "movie" ? "movie" : "tv";
}

function extractYear(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

function getFileExtension(value: string | undefined): string | null {
  if (!value || !value.includes(".")) {
    return null;
  }

  return value.slice(value.lastIndexOf(".") + 1).toLowerCase();
}

function dedupeSubtitleRows(
  rows: Array<{
    media_id: number | null;
    episode_id: number | null;
    provider: string;
    language_code: string;
    external_subtitle_id: string;
    external_file_id: string;
    release_name: string | null;
    file_name: string | null;
    format: string | null;
    is_hearing_impaired: boolean;
    is_ai_generated: boolean;
    source_kind: string;
    download_status: string;
    score: number | null;
    downloads_count: number | null;
    raw_payload: OpenSubtitlesSearchItem;
  }>
) {
  const uniqueRows = new Map<string, (typeof rows)[number]>();

  for (const row of rows) {
    const key = `${row.provider}:${row.external_file_id}`;
    const existing = uniqueRows.get(key);

    if (!existing) {
      uniqueRows.set(key, row);
      continue;
    }

    const existingDownloads = existing.downloads_count ?? -1;
    const nextDownloads = row.downloads_count ?? -1;
    const existingScore = existing.score ?? -1;
    const nextScore = row.score ?? -1;

    if (
      nextDownloads > existingDownloads ||
      (nextDownloads === existingDownloads && nextScore > existingScore)
    ) {
      uniqueRows.set(key, row);
    }
  }

  return Array.from(uniqueRows.values());
}

type RankedSubtitleMatch = {
  item: OpenSubtitlesSearchItem;
  rankScore: number;
};

function rankSubtitleMatches(input: {
  subtitles: OpenSubtitlesSearchItem[];
  titles: string[];
  type: "movie" | "episode";
  year?: number;
  imdbId?: string | null;
  tmdbId?: number | null;
  seasonNumber?: number;
  episodeNumber?: number;
}) {
  return input.subtitles
    .map((subtitle) => ({
      item: subtitle,
      rankScore: scoreSubtitleMatch(subtitle, input)
    }))
    .filter((subtitle) => subtitle.rankScore > 0)
    .sort((left, right) => {
      const byScore = right.rankScore - left.rankScore;

      if (byScore !== 0) {
        return byScore;
      }

      const byDownloads =
        (right.item.attributes.download_count ?? 0) - (left.item.attributes.download_count ?? 0);

      if (byDownloads !== 0) {
        return byDownloads;
      }

      return (right.item.attributes.ratings ?? 0) - (left.item.attributes.ratings ?? 0);
    })
    .slice(0, 15);
}

function scoreSubtitleMatch(
  subtitle: OpenSubtitlesSearchItem,
  input: {
    titles: string[];
    type: "movie" | "episode";
    year?: number;
    imdbId?: string | null;
    tmdbId?: number | null;
    seasonNumber?: number;
    episodeNumber?: number;
  }
) {
  const details = subtitle.attributes.feature_details;
  const identifierMatch = hasExactSubtitleIdentifierMatch(details, input);

  if (identifierMatch === false) {
    return 0;
  }

  let score = 0;

  if (identifierMatch === true) {
    score += 200;
  }

  if (
    input.type === "episode" &&
    ((input.seasonNumber !== undefined &&
      details?.season_number !== undefined &&
      details.season_number !== null &&
      details.season_number !== input.seasonNumber) ||
      (input.episodeNumber !== undefined &&
        details?.episode_number !== undefined &&
        details.episode_number !== null &&
        details.episode_number !== input.episodeNumber))
  ) {
    return 0;
  }

  if (input.type === "episode" && input.seasonNumber !== undefined && input.episodeNumber !== undefined) {
    score += 60;
  }

  if (
    input.year !== undefined &&
    details?.year !== undefined &&
    details.year !== null &&
    Math.abs(details.year - input.year) > 1
  ) {
    return 0;
  }

  if (input.year !== undefined && details?.year === input.year) {
    score += 40;
  }

  const releaseTexts = collectSubtitleReleaseTexts(subtitle);
  if (releaseTexts.length > 0) {
    const bestReleaseScore = Math.max(
      ...releaseTexts.map((text) =>
        scorePreferredTitles(text, input.titles, {
          allowRelaxedTokenMatch: identifierMatch === true
        })
      )
    );

    if (bestReleaseScore <= 0) {
      return 0;
    }

    score += bestReleaseScore;
  } else {
    const detailTexts = [details?.movie_name, details?.title].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );

    const bestDetailScore = detailTexts.length
      ? Math.max(
          ...detailTexts.map((text) =>
            scorePreferredTitles(text, input.titles, {
              allowRelaxedTokenMatch: identifierMatch === true
            })
          )
        )
      : 0;

    if (bestDetailScore <= 0) {
      return 0;
    }

    score += bestDetailScore;
  }

  score += Math.min(120, Math.floor((subtitle.attributes.download_count ?? 0) / 500));

  if (subtitle.attributes.hearing_impaired) {
    score -= 10;
  }

  if (subtitle.attributes.ai_translated) {
    score -= 40;
  }

  return Math.max(score, 0);
}

function hasExactSubtitleIdentifierMatch(
  details: OpenSubtitlesSearchItem["attributes"]["feature_details"],
  input: { imdbId?: string | null; tmdbId?: number | null }
) {
  let matched = false;

  if (input.tmdbId != null && details?.tmdb_id != null) {
    if (details.tmdb_id !== input.tmdbId) {
      return false;
    }

    matched = true;
  }

  const normalizedImdbId = normalizeComparableImdbId(input.imdbId);
  if (normalizedImdbId && details?.imdb_id != null) {
    if (String(details.imdb_id) !== normalizedImdbId) {
      return false;
    }

    matched = true;
  }

  return matched;
}

function collectPreferredTitles(mediaInfo: SflixMediaInfo, tmdbBundle: TmdbBundle | null) {
  const titles = [mediaInfo.title];

  if (tmdbBundle?.type === "movie") {
    titles.push(
      tmdbBundle.localized.title,
      tmdbBundle.fallback.title,
      tmdbBundle.fallback.original_title
    );
  }

  if (tmdbBundle?.type === "tv") {
    titles.push(tmdbBundle.localized.name, tmdbBundle.fallback.name, tmdbBundle.fallback.original_name);
  }

  return Array.from(new Set(titles.map((title) => title.trim()).filter((title) => title.length > 0)));
}

function collectSubtitleReleaseTexts(subtitle: OpenSubtitlesSearchItem) {
  return Array.from(
    new Set(
      [subtitle.attributes.release, ...subtitle.attributes.files.map((file) => file.file_name)]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );
}

function scorePreferredTitles(
  text: string,
  titles: string[],
  options: { allowRelaxedTokenMatch: boolean }
) {
  const normalizedText = normalizeSubtitleText(text);

  return titles.reduce((bestScore, title) => {
    const normalizedTitle = normalizeSubtitleText(title);
    if (!normalizedTitle) {
      return bestScore;
    }

    if (
      normalizedText === normalizedTitle
    ) {
      return Math.max(bestScore, 140);
    }

    if (normalizedText.includes(normalizedTitle)) {
      return Math.max(bestScore, 120);
    }

    if (normalizedTitle.includes(normalizedText)) {
      return Math.max(bestScore, 80);
    }

    if (!options.allowRelaxedTokenMatch) {
      return bestScore;
    }

    const significantTokens = extractSignificantTokens(normalizedTitle);
    if (significantTokens.length === 0) {
      return bestScore;
    }

    const textTokens = new Set(normalizedText.split(" ").filter((token) => token.length > 0));
    return significantTokens.every((token) => textTokens.has(token))
      ? Math.max(bestScore, 90)
      : bestScore;
  }, 0);
}

function normalizeComparableImdbId(imdbId: string | null | undefined) {
  if (!imdbId) {
    return null;
  }

  const numericPart = imdbId.startsWith("tt") ? imdbId.slice(2) : imdbId;
  const normalized = Number(numericPart);

  return Number.isFinite(normalized) ? String(normalized) : numericPart;
}

function normalizeSubtitleText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function extractSignificantTokens(value: string) {
  return value
    .split(" ")
    .filter(
      (token) =>
        token.length >= 4 && !["this", "that", "with", "from", "the", "and"].includes(token)
    );
}
