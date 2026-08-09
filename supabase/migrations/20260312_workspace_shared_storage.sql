-- Workspace + shared storage for dashboards/snippets/history

create type if not exists public.workspace_role as enum ('owner', 'admin', 'member');

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_dashboard_folders (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_dashboards (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  folder_id text references public.workspace_dashboard_folders(id) on delete set null,
  name text not null,
  widgets jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_snippet_folders (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_snippets (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  folder_id text references public.workspace_snippet_folders(id) on delete set null,
  name text not null,
  query text not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_query_history (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  query text not null,
  executed_at timestamptz not null,
  duration_ms integer not null,
  status text not null check (status in ('success','error')),
  error text,
  rows_count integer,
  caller text not null check (caller in ('user','system')),
  executed_by uuid references public.profiles(id) on delete set null,
  executed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_members_user on public.workspace_members (user_id);
create index if not exists idx_workspace_members_workspace on public.workspace_members (workspace_id);
create index if not exists idx_workspace_dashboards_workspace on public.workspace_dashboards (workspace_id);
create index if not exists idx_workspace_dashboard_folders_workspace on public.workspace_dashboard_folders (workspace_id);
create index if not exists idx_workspace_snippets_workspace on public.workspace_snippets (workspace_id);
create index if not exists idx_workspace_snippet_folders_workspace on public.workspace_snippet_folders (workspace_id);
create index if not exists idx_workspace_query_history_workspace on public.workspace_query_history (workspace_id, executed_at desc);

-- Updated_at triggers
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_workspaces_updated_at
before update on public.workspaces
for each row execute function public.touch_updated_at();

create trigger touch_workspace_dashboard_folders_updated_at
before update on public.workspace_dashboard_folders
for each row execute function public.touch_updated_at();

create trigger touch_workspace_dashboards_updated_at
before update on public.workspace_dashboards
for each row execute function public.touch_updated_at();

create trigger touch_workspace_snippet_folders_updated_at
before update on public.workspace_snippet_folders
for each row execute function public.touch_updated_at();

create trigger touch_workspace_snippets_updated_at
before update on public.workspace_snippets
for each row execute function public.touch_updated_at();

-- RLS helpers
create or replace function public.is_workspace_member(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = coalesce(p_user_id, auth.uid())
  );
$$;

create or replace function public.is_workspace_admin(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = coalesce(p_user_id, auth.uid())
      and wm.role in ('owner','admin')
  );
$$;

-- Enable RLS
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_dashboard_folders enable row level security;
alter table public.workspace_dashboards enable row level security;
alter table public.workspace_snippet_folders enable row level security;
alter table public.workspace_snippets enable row level security;
alter table public.workspace_query_history enable row level security;

-- Workspaces policies
create policy "workspace_select" on public.workspaces
for select to authenticated
using (public.is_workspace_member(id));

create policy "workspace_insert" on public.workspaces
for insert to authenticated
with check (owner_id = auth.uid());

create policy "workspace_update" on public.workspaces
for update to authenticated
using (public.is_workspace_admin(id))
with check (public.is_workspace_admin(id));

create policy "workspace_delete" on public.workspaces
for delete to authenticated
using (public.is_workspace_admin(id));

-- Workspace members policies
create policy "workspace_members_select" on public.workspace_members
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_members_insert" on public.workspace_members
for insert to authenticated
with check (
  (user_id = auth.uid() and (
    public.is_workspace_admin(workspace_id)
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id
        and w.owner_id = auth.uid()
    )
  ))
  or public.is_workspace_admin(workspace_id)
);

create policy "workspace_members_update" on public.workspace_members
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

create policy "workspace_members_delete" on public.workspace_members
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

-- Shared data policies
create policy "workspace_dashboard_folders_select" on public.workspace_dashboard_folders
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_dashboard_folders_write" on public.workspace_dashboard_folders
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "workspace_dashboard_folders_update" on public.workspace_dashboard_folders
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "workspace_dashboard_folders_delete" on public.workspace_dashboard_folders
for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_dashboards_select" on public.workspace_dashboards
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_dashboards_write" on public.workspace_dashboards
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "workspace_dashboards_update" on public.workspace_dashboards
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "workspace_dashboards_delete" on public.workspace_dashboards
for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_snippet_folders_select" on public.workspace_snippet_folders
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_snippet_folders_write" on public.workspace_snippet_folders
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "workspace_snippet_folders_update" on public.workspace_snippet_folders
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "workspace_snippet_folders_delete" on public.workspace_snippet_folders
for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_snippets_select" on public.workspace_snippets
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_snippets_write" on public.workspace_snippets
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "workspace_snippets_update" on public.workspace_snippets
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "workspace_snippets_delete" on public.workspace_snippets
for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_query_history_select" on public.workspace_query_history
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_query_history_insert" on public.workspace_query_history
for insert to authenticated
with check (public.is_workspace_member(workspace_id) and executed_by = auth.uid());

create policy "workspace_query_history_delete" on public.workspace_query_history
for delete to authenticated
using (public.is_workspace_member(workspace_id));
