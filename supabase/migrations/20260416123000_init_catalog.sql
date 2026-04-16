create schema if not exists internal;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'media_type'
  ) then
    create type public.media_type as enum ('movie', 'tv');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'ingestion_status'
  ) then
    create type public.ingestion_status as enum ('pending', 'running', 'succeeded', 'failed');
  end if;
end $$;

create table if not exists public.media (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid(),
  media_type public.media_type not null,
  canonical_provider text not null,
  canonical_external_id text not null,
  original_title text not null,
  original_overview text,
  release_year integer,
  original_language text,
  status text,
  runtime_minutes integer,
  poster_url text,
  backdrop_url text,
  popularity numeric(10, 3),
  vote_average numeric(4, 2),
  vote_count integer,
  adult boolean not null default false,
  metadata_source text not null,
  subtitle_source text,
  ingestion_confidence numeric(4, 3),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint media_public_id_unique unique (public_id),
  constraint media_canonical_unique unique (canonical_provider, canonical_external_id),
  constraint media_release_year_check check (release_year is null or release_year between 1888 and 3000),
  constraint media_runtime_minutes_check check (runtime_minutes is null or runtime_minutes >= 0),
  constraint media_popularity_check check (popularity is null or popularity >= 0),
  constraint media_vote_average_check check (vote_average is null or vote_average between 0 and 10),
  constraint media_vote_count_check check (vote_count is null or vote_count >= 0),
  constraint media_confidence_check check (ingestion_confidence is null or ingestion_confidence between 0 and 1)
);

create table if not exists public.media_external_ids (
  id bigint generated always as identity primary key,
  media_id bigint not null references public.media(id) on delete cascade,
  provider text not null,
  external_id text not null,
  external_url text,
  is_primary boolean not null default false,
  raw_payload jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint media_external_ids_unique unique (provider, external_id)
);

create table if not exists public.media_localizations (
  id bigint generated always as identity primary key,
  media_id bigint not null references public.media(id) on delete cascade,
  lang text not null,
  title text not null,
  overview text,
  source_provider text not null,
  source_kind text not null,
  is_default boolean not null default false,
  confidence numeric(4, 3),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint media_localizations_unique unique (media_id, lang),
  constraint media_localizations_confidence_check check (confidence is null or confidence between 0 and 1)
);

create table if not exists public.seasons (
  id bigint generated always as identity primary key,
  media_id bigint not null references public.media(id) on delete cascade,
  season_number integer not null,
  title text,
  overview text,
  air_date date,
  poster_url text,
  episode_count integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint seasons_unique unique (media_id, season_number),
  constraint seasons_number_check check (season_number >= 0),
  constraint seasons_episode_count_check check (episode_count is null or episode_count >= 0)
);

create table if not exists public.episodes (
  id bigint generated always as identity primary key,
  media_id bigint not null references public.media(id) on delete cascade,
  season_id bigint references public.seasons(id) on delete cascade,
  season_number integer not null,
  episode_number integer not null,
  title text not null,
  overview text,
  release_date date,
  runtime_minutes integer,
  still_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint episodes_unique unique (media_id, season_number, episode_number),
  constraint episodes_season_number_check check (season_number >= 0),
  constraint episodes_episode_number_check check (episode_number >= 0),
  constraint episodes_runtime_minutes_check check (runtime_minutes is null or runtime_minutes >= 0)
);

create table if not exists public.episode_external_ids (
  id bigint generated always as identity primary key,
  episode_id bigint not null references public.episodes(id) on delete cascade,
  provider text not null,
  external_id text not null,
  external_url text,
  raw_payload jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint episode_external_ids_unique unique (provider, external_id)
);

create table if not exists public.subtitle_tracks (
  id bigint generated always as identity primary key,
  media_id bigint references public.media(id) on delete cascade,
  episode_id bigint references public.episodes(id) on delete cascade,
  provider text not null,
  language_code text not null,
  external_subtitle_id text,
  external_file_id text,
  release_name text,
  file_name text,
  format text,
  is_hearing_impaired boolean not null default false,
  is_ai_generated boolean not null default false,
  source_kind text not null default 'discovered',
  download_url text,
  storage_path text,
  download_status text not null default 'discovered',
  score numeric(10, 3),
  downloads_count integer,
  raw_payload jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint subtitle_tracks_owner_check check (
    (media_id is not null and episode_id is null)
    or (media_id is null and episode_id is not null)
  )
);

create table if not exists internal.ingestion_jobs (
  id bigint generated always as identity primary key,
  provider text not null,
  job_type text not null,
  status public.ingestion_status not null default 'pending',
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists internal.provider_payloads (
  id bigint generated always as identity primary key,
  provider text not null,
  entity_type text not null,
  entity_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists subtitle_tracks_provider_file_unique_idx
  on public.subtitle_tracks (provider, external_file_id)
  where external_file_id is not null;

create index if not exists media_external_ids_media_id_idx
  on public.media_external_ids (media_id);

create index if not exists media_external_ids_provider_external_id_idx
  on public.media_external_ids (provider, external_id);

create index if not exists media_localizations_media_id_idx
  on public.media_localizations (media_id);

create index if not exists media_localizations_lang_idx
  on public.media_localizations (lang);

create index if not exists media_localizations_title_fts_idx
  on public.media_localizations
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(overview, '')));

create index if not exists seasons_media_id_idx
  on public.seasons (media_id);

create index if not exists episodes_media_id_idx
  on public.episodes (media_id);

create index if not exists episodes_season_id_idx
  on public.episodes (season_id);

create index if not exists episode_external_ids_episode_id_idx
  on public.episode_external_ids (episode_id);

create index if not exists subtitle_tracks_media_id_idx
  on public.subtitle_tracks (media_id);

create index if not exists subtitle_tracks_episode_id_idx
  on public.subtitle_tracks (episode_id);

create index if not exists subtitle_tracks_language_code_idx
  on public.subtitle_tracks (language_code);

create index if not exists ingestion_jobs_status_idx
  on internal.ingestion_jobs (status, created_at desc);

create index if not exists provider_payloads_provider_entity_idx
  on internal.provider_payloads (provider, entity_type, entity_key, fetched_at desc);

drop trigger if exists media_set_updated_at on public.media;
create trigger media_set_updated_at
before update on public.media
for each row execute function public.set_updated_at();

drop trigger if exists media_external_ids_set_updated_at on public.media_external_ids;
create trigger media_external_ids_set_updated_at
before update on public.media_external_ids
for each row execute function public.set_updated_at();

drop trigger if exists media_localizations_set_updated_at on public.media_localizations;
create trigger media_localizations_set_updated_at
before update on public.media_localizations
for each row execute function public.set_updated_at();

drop trigger if exists seasons_set_updated_at on public.seasons;
create trigger seasons_set_updated_at
before update on public.seasons
for each row execute function public.set_updated_at();

drop trigger if exists episodes_set_updated_at on public.episodes;
create trigger episodes_set_updated_at
before update on public.episodes
for each row execute function public.set_updated_at();

drop trigger if exists episode_external_ids_set_updated_at on public.episode_external_ids;
create trigger episode_external_ids_set_updated_at
before update on public.episode_external_ids
for each row execute function public.set_updated_at();

drop trigger if exists subtitle_tracks_set_updated_at on public.subtitle_tracks;
create trigger subtitle_tracks_set_updated_at
before update on public.subtitle_tracks
for each row execute function public.set_updated_at();

drop trigger if exists ingestion_jobs_set_updated_at on internal.ingestion_jobs;
create trigger ingestion_jobs_set_updated_at
before update on internal.ingestion_jobs
for each row execute function public.set_updated_at();

alter table public.media enable row level security;
alter table public.media_external_ids enable row level security;
alter table public.media_localizations enable row level security;
alter table public.seasons enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_external_ids enable row level security;
alter table public.subtitle_tracks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'media'
      and policyname = 'public_read_media'
  ) then
    create policy public_read_media on public.media for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'media_external_ids'
      and policyname = 'public_read_media_external_ids'
  ) then
    create policy public_read_media_external_ids on public.media_external_ids for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'media_localizations'
      and policyname = 'public_read_media_localizations'
  ) then
    create policy public_read_media_localizations on public.media_localizations for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'seasons'
      and policyname = 'public_read_seasons'
  ) then
    create policy public_read_seasons on public.seasons for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'public_read_episodes'
  ) then
    create policy public_read_episodes on public.episodes for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'episode_external_ids'
      and policyname = 'public_read_episode_external_ids'
  ) then
    create policy public_read_episode_external_ids on public.episode_external_ids for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'subtitle_tracks'
      and policyname = 'public_read_subtitle_tracks'
  ) then
    create policy public_read_subtitle_tracks on public.subtitle_tracks for select using (true);
  end if;
end $$;

