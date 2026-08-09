-- Ensure members can insert/update/delete shared snippets

drop policy if exists "workspace_snippets_insert" on public.workspace_snippets;
create policy "workspace_snippets_insert" on public.workspace_snippets
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_snippets_update" on public.workspace_snippets;
create policy "workspace_snippets_update" on public.workspace_snippets
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_snippets_delete" on public.workspace_snippets;
create policy "workspace_snippets_delete" on public.workspace_snippets
for delete to authenticated
using (public.is_workspace_member(workspace_id));

-- Dashboards (for parity)
drop policy if exists "workspace_dashboards_insert" on public.workspace_dashboards;
create policy "workspace_dashboards_insert" on public.workspace_dashboards
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_dashboards_update" on public.workspace_dashboards;
create policy "workspace_dashboards_update" on public.workspace_dashboards
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_dashboards_delete" on public.workspace_dashboards;
create policy "workspace_dashboards_delete" on public.workspace_dashboards
for delete to authenticated
using (public.is_workspace_member(workspace_id));
