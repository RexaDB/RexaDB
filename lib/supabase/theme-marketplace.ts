import { supabase } from "@/lib/supabase/client";

export interface CommunityTheme {
  id: string;
  name: string;
  description: string;
  theme_type: "app" | "editor";
  theme_json: Record<string, unknown>;
  author_id: string;
  author_name: string;
  downloads: number;
  created_at: string;
  updated_at: string;
}

export interface FetchThemesParams {
  type?: "app" | "editor";
  search?: string;
  limit?: number;
  offset?: number;
}

export async function fetchCommunityThemes(
  params: FetchThemesParams = {}
): Promise<{ themes: CommunityTheme[]; error: string | null }> {
  const { type, search, limit = 50, offset = 0 } = params;

  let query = supabase
    .from("community_themes")
    .select("*", { count: "exact" })
    .order("downloads", { ascending: false })
    .range(offset, offset + limit - 1);

  if (type) {
    query = query.eq("theme_type", type);
  }

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    return { themes: [], error: error.message };
  }

  return {
    themes: (data as unknown as CommunityTheme[]) || [],
    error: null,
  };
}

export async function publishTheme(params: {
  name: string;
  description: string;
  themeType: "app" | "editor";
  themeJson: Record<string, unknown>;
}): Promise<{ id: string | null; error: string | null }> {
  const { data: id, error } = await supabase.rpc("publish_community_theme", {
    p_name: params.name,
    p_description: params.description,
    p_theme_type: params.themeType,
    p_theme_json: params.themeJson,
  });

  if (error) {
    return { id: null, error: error.message };
  }

  return { id: id as string | null, error: null };
}

export async function incrementDownloadCount(
  themeId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("increment_theme_downloads", {
    theme_id: themeId,
  });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

export async function deletePublishedTheme(
  themeId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("community_themes")
    .delete()
    .eq("id", themeId);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

export async function fetchUserPublishedThemes(
  userId: string
): Promise<{ themes: CommunityTheme[]; error: string | null }> {
  const { data, error } = await supabase
    .from("community_themes")
    .select("*")
    .eq("author_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { themes: [], error: error.message };
  }

  return {
    themes: (data as unknown as CommunityTheme[]) || [],
    error: null,
  };
}
