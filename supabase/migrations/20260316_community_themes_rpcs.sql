-- RPCs for the community themes marketplace.
-- These are split into a separate migration so they can be applied/reverted independently.

-- RPC: increment download count
create or replace function public.increment_theme_downloads(theme_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.community_themes
  set downloads = downloads + 1
  where id = theme_id;
end;
$$;

-- RPC: publish a theme — resolves author name server-side, never exposes email
create or replace function public.publish_community_theme(
  p_name text,
  p_description text,
  p_theme_type text,
  p_theme_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_author_name text;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Theme Creator')
  into v_author_name
  from public.profiles
  where id = v_user_id;

  insert into public.community_themes (name, description, theme_type, theme_json, author_id, author_name)
  values (p_name, p_description, p_theme_type, p_theme_json, v_user_id, v_author_name)
  returning id into v_id;

  return v_id;
end;
$$;

-- RPC: get the current user's display name — never exposes email
create or replace function public.get_my_display_name()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
begin
  if v_user_id is null then
    return null;
  end if;

  select nullif(trim(full_name), '')
  into v_name
  from public.profiles
  where id = v_user_id;

  return v_name;
end;
$$;
