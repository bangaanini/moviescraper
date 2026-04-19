create table if not exists public.media_feed_items (
  id bigint generated always as identity primary key,
  feed_kind text not null,
  page_number integer not null,
  position integer not null,
  media_id bigint not null references public.media(id) on delete cascade,
  source_provider text not null,
  source_external_id text not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint media_feed_items_page_number_check check (page_number >= 1),
  constraint media_feed_items_position_check check (position >= 1),
  constraint media_feed_items_unique_position unique (feed_kind, page_number, position),
  constraint media_feed_items_unique_media unique (feed_kind, page_number, media_id)
);

create index if not exists media_feed_items_feed_page_idx
  on public.media_feed_items (feed_kind, page_number, position);

create index if not exists media_feed_items_media_id_idx
  on public.media_feed_items (media_id);

drop trigger if exists media_feed_items_set_updated_at on public.media_feed_items;
create trigger media_feed_items_set_updated_at
before update on public.media_feed_items
for each row execute function public.set_updated_at();
