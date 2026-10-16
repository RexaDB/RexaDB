import { makePool } from "../_shared/auth";

const pool = makePool();

// Serves electron-updater compatible latest-mac.yml from the releases table.
// Paths: /updates/mac/latest-mac.yml or /updates/latest-mac.yml
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Paths: /updates/mac/latest-mac.yml or /updates/latest-mac.yml
    // Strip the function slug so the short form keeps platform=mac.
    const parts = url.pathname.split("/").filter(Boolean);
    const updatesIdx = parts.indexOf("updates");
    const after = updatesIdx >= 0 ? parts.slice(updatesIdx + 1) : parts;

    let platform = "mac";
    let filename = "";
    if (after.length >= 2) {
      platform = after[0];
      filename = after[1];
    } else if (after.length === 1) {
      filename = after[0];
    }

    if (filename !== "latest-mac.yml") {
      return new Response("Not found", { status: 404 });
    }

    const { rows } = await pool.query(
      `SELECT version, file_url, sha512, size, published_at FROM public.releases
       WHERE channel = 'stable' AND platform = $1
       ORDER BY published_at DESC LIMIT 1`,
      [platform],
    );
    const data = rows[0] as
      | {
          version: string;
          file_url: string;
          sha512: string;
          size: number;
          published_at: string;
        }
      | undefined;
    if (!data) {
      return new Response("No release found", { status: 404 });
    }

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
  },
};
