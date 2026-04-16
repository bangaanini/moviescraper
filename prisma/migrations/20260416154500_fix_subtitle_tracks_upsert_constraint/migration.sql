drop index if exists public.subtitle_tracks_provider_file_unique_idx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subtitle_tracks_provider_file_unique_idx'
      and conrelid = 'public.subtitle_tracks'::regclass
  ) then
    alter table public.subtitle_tracks
      add constraint subtitle_tracks_provider_file_unique_idx
      unique (provider, external_file_id);
  end if;
end $$;
