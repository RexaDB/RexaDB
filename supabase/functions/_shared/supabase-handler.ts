import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { corsHeaders } from "./cors.ts";

export function handleCorsOrMethod(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}

export function loadSupabaseEnv() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const polarAccessToken = Deno.env.get("POLAR_ACCESS_TOKEN");
  const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:3000";
  return { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, polarAccessToken, appUrl };
}

export function missingEnvResponse(): Response {
  return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function missingAuthResponse(): Response {
  return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createClients(
  supabaseUrl: string,
  supabaseAnonKey: string,
  serviceRoleKey: string,
  authHeader: string,
) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey);
  return { supabase, admin };
}

export async function getAuthUser(supabase: ReturnType<typeof createClient>) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;
  return user;
}
