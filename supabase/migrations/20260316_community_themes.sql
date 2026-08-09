-- Community themes marketplace.
-- Anyone can browse; authenticated users can publish, update, or delete their own.

create table if not exists public.community_themes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  theme_type text not null check (theme_type in ('app', 'editor')),
  theme_json jsonb not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text default '',
  downloads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_community_themes_type
  on public.community_themes (theme_type);

create index if not exists idx_community_themes_author
  on public.community_themes (author_id);

create index if not exists idx_community_themes_downloads
  on public.community_themes (downloads desc);

alter table public.community_themes enable row level security;

drop policy if exists "community_themes_select" on public.community_themes;
create policy "community_themes_select"
on public.community_themes
for select
to anon, authenticated
using (true);

drop policy if exists "community_themes_insert" on public.community_themes;
create policy "community_themes_insert"
on public.community_themes
for insert
to authenticated
with check (auth.uid() = author_id);

drop policy if exists "community_themes_update" on public.community_themes;
create policy "community_themes_update"
on public.community_themes
for update
to authenticated
using (auth.uid() = author_id);

drop policy if exists "community_themes_delete" on public.community_themes;
create policy "community_themes_delete"
on public.community_themes
for delete
to authenticated
using (auth.uid() = author_id);

drop trigger if exists set_updated_at_community_themes on public.community_themes;
create trigger set_updated_at_community_themes
before update on public.community_themes
for each row execute function public.set_updated_at();
