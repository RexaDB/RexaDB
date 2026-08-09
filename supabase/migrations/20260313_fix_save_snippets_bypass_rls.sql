create or replace function public.save_workspace_snippets(
  p_workspace_id uuid,
  p_folders jsonb,
  p_snippets jsonb,
  p_allow_empty boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public,
    row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_folder_ids text[];
  v_snippet_ids text[];
begin
  if v_user is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized.');
  end if;

  if not public.is_workspace_member(p_workspace_id, v_user) then
    return jsonb_build_object('success', false, 'error', 'Forbidden.');
  end if;

  if (not p_allow_empty) and (coalesce(jsonb_array_length(p_folders), 0) = 0) and (coalesce(jsonb_array_length(p_snippets), 0) = 0) then
    return jsonb_build_object('success', true);
  end if;

  with folder_rows as (
    select
      (f->>'id')::text as id,
      p_workspace_id as workspace_id,
      coalesce(nullif(trim(f->>'name'), ''), 'Untitled Folder') as name,
      v_user as created_by,
      v_user as updated_by
    from jsonb_array_elements(coalesce(p_folders, '[]'::jsonb)) f
  )
  insert into public.workspace_snippet_folders (id, workspace_id, name, created_by, updated_by)
  select id, workspace_id, name, created_by, updated_by from folder_rows
  on conflict (id) do update
    set name = excluded.name,
        updated_by = excluded.updated_by,
        updated_at = now();

  with folder_ids as (
    select (f->>'id')::text as id
    from jsonb_array_elements(coalesce(p_folders, '[]'::jsonb)) f
  ),
  snippet_rows as (
    select
      (s->>'id')::text as id,
      p_workspace_id as workspace_id,
      case
        when (s->>'folderId') is null then null
        when exists (select 1 from folder_ids fi where fi.id = (s->>'folderId')::text)
          then (s->>'folderId')::text
        else null
      end as folder_id,
      coalesce(nullif(trim(s->>'name'), ''), 'Untitled Snippet') as name,
      coalesce(s->>'query','') as query,
      v_user as created_by,
      v_user as updated_by
    from jsonb_array_elements(coalesce(p_snippets, '[]'::jsonb)) s
  )
  insert into public.workspace_snippets (id, workspace_id, folder_id, name, query, created_by, updated_by)
  select id, workspace_id, folder_id, name, query, created_by, updated_by from snippet_rows
  on conflict (id) do update
    set name = excluded.name,
        query = excluded.query,
        folder_id = excluded.folder_id,
        updated_by = excluded.updated_by,
        updated_at = now();

  select array_agg((f->>'id')::text) into v_folder_ids
  from jsonb_array_elements(coalesce(p_folders, '[]'::jsonb)) f;

  select array_agg((s->>'id')::text) into v_snippet_ids
  from jsonb_array_elements(coalesce(p_snippets, '[]'::jsonb)) s;

  delete from public.workspace_snippets
  where workspace_id = p_workspace_id
    and (v_snippet_ids is null or id <> all(v_snippet_ids));

  delete from public.workspace_snippet_folders
  where workspace_id = p_workspace_id
    and (v_folder_ids is null or id <> all(v_folder_ids));

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.save_workspace_snippets(uuid, jsonb, jsonb, boolean) to authenticated;
