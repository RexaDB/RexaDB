-- Fix RLS policies for workspace dashboards and folders

-- Ensure RLS is enabled
alter table if exists public.workspace_dashboard_folders enable row level security;
alter table if exists public.workspace_dashboards enable row level security;

-- Drop any existing policies to avoid conflicts
DO $$
BEGIN
  -- Dashboard folders
  PERFORM 1;
  execute 'drop policy if exists "workspace_dashboard_folders_select" on public.workspace_dashboard_folders';
  execute 'drop policy if exists "workspace_dashboard_folders_write" on public.workspace_dashboard_folders';
  execute 'drop policy if exists "workspace_dashboard_folders_insert" on public.workspace_dashboard_folders';
  execute 'drop policy if exists "workspace_dashboard_folders_update" on public.workspace_dashboard_folders';
  execute 'drop policy if exists "workspace_dashboard_folders_delete" on public.workspace_dashboard_folders';

  -- Dashboards
  execute 'drop policy if exists "workspace_dashboards_select" on public.workspace_dashboards';
  execute 'drop policy if exists "workspace_dashboards_write" on public.workspace_dashboards';
  execute 'drop policy if exists "workspace_dashboards_insert" on public.workspace_dashboards';
  execute 'drop policy if exists "workspace_dashboards_update" on public.workspace_dashboards';
  execute 'drop policy if exists "workspace_dashboards_delete" on public.workspace_dashboards';
END $$;

-- Recreate policies allowing any workspace member
create policy "workspace_dashboard_folders_select" on public.workspace_dashboard_folders
for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_dashboard_folders_insert" on public.workspace_dashboard_folders
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

create policy "workspace_dashboards_insert" on public.workspace_dashboards
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "workspace_dashboards_update" on public.workspace_dashboards
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "workspace_dashboards_delete" on public.workspace_dashboards
for delete to authenticated
using (public.is_workspace_member(workspace_id));
