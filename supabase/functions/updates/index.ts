import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);

  // Expected examples:
  // /functions/v1/updates/mac/latest-mac.yml
  // /functions/v1/updates/latest-mac.yml
  const parts = url.pathname.split("/").filter(Boolean);
  const filename = parts[parts.length - 1] || "";
  
  console.log(`[Updates] Request path: ${url.pathname}`);
  console.log(`[Updates] Filename: ${filename}`);

  // Determine base platform and explicit arch from path
  // Expected paths:
  // /updates/mac/arm64/latest-mac.yml -> platform: mac, arch: arm64
  // /updates/mac/latest-mac.yml       -> platform: mac, arch: (detect)
  let platform = "mac";
  let explicitArch = "";

  if (url.pathname.includes("/linux")) platform = "linux";
  else if (url.pathname.includes("/win")) platform = "win";

  // Check if arch is explicitly in the path parts
  if (parts.includes("arm64")) explicitArch = "arm64";
  else if (parts.includes("x64")) explicitArch = "x64";

  // Detect architecture from User-Agent as fallback
  let arch = explicitArch;
  const ua = req.headers.get("user-agent")?.toLowerCase() || "";
  console.log(`[Updates] User-Agent: ${ua}`);
  
  if (!arch) {
    if (ua.includes("arm64") || ua.includes("aarch64")) arch = "arm64";
    else if (ua.includes("x64") || ua.includes("x86_64") || ua.includes("amd64")) arch = "x64";
  }
  
  console.log(`[Updates] Detected platform: ${platform}, arch: ${arch || 'none'} (explicit: ${!!explicitArch})`);

  // Construct search platforms
  const searchPlatforms = arch 
    ? [`${platform}-${arch}`, platform] 
    : [`${platform}-arm64`, `${platform}-x64`, platform];
    
  console.log(`[Updates] Searching for platforms: ${searchPlatforms.join(', ')}`);

  if (!filename.startsWith("latest")) {
    console.log(`[Updates] 404: Filename does not start with latest`);
    return new Response("Not found", { status: 404 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Find the latest release matching any of our search platforms
  const { data, error } = await supabase
    .from("releases")
    .select("*")
    .eq("channel", "stable")
    .in("platform", searchPlatforms)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error("[Updates] No release found in database for platforms:", searchPlatforms, "error:", error);
    return new Response("No release found", { status: 404 });
  }

  console.log(`[Updates] Found release: version=${data.version}, platform=${data.platform}, url=${data.file_url}`);

  const yaml = [
    `version: ${data.version}`,
    `files:`,
    `  - url: ${data.file_url}`,
    `    sha512: ${data.sha512}`,
    `    size: ${data.size}`,
    `path: ${data.file_url}`,
    `sha512: ${data.sha512}`,
    `releaseDate: '${new Date(data.published_at).toISOString()}'`,
  ].join("\n");

  return new Response(yaml, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
    },
  });
});

