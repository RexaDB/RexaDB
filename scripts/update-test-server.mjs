#!/usr/bin/env bun
/**
 * update-test-server.mjs
 *
 * A minimal local HTTP server that mimics the Tauri updater's GitHub Releases
 * endpoint by serving the `latest.json` manifest and the signed bundle files
 * from a directory (default: ./update-test-root).
 *
 * This is only for TESTING the in-app updater locally. It never touches
 * production releases.
 *
 * Usage:
 *   bun run scripts/make-test-update.mjs            # generate latest.json first
 *   bun run scripts/update-test-server.mjs          # serve it
 *
 * Options:
 *   --port <port>   port to listen on (default 38472)
 *   --root <dir>    directory to serve (default ./update-test-root)
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, join, normalize, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const opts = parseArgs({
  options: {
    port: { type: "string", default: "38472" },
    root: { type: "string", default: "update-test-root" },
    help: { type: "boolean", default: false },
  },
}).values;

if (opts.help) {
  console.log(`Usage: bun run scripts/update-test-server.mjs [--port 38472] [--root ./update-test-root]`);
  process.exit(0);
}

const PORT = Number(opts.port);
const ROOT = resolve(PROJECT_ROOT, opts.root);

const MIME = {
  ".json": "application/json",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".dmg": "application/octet-stream",
  ".deb": "application/vnd.debian.binary-package",
  ".AppImage": "application/octet-stream",
  ".exe": "application/octet-stream",
  ".sig": "text/plain",
};

function log(method, url, status, bytes) {
  const size = bytes != null ? ` ${bytes}b` : "";
  console.log(`[${new Date().toISOString()}] ${method} ${url} -> ${status}${size}`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  // Serve only files from root; reject anything that escapes it.
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return log(req.method, pathname, 403);
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
    return log(req.method, pathname, 404);
  }

  const ext = extname(filePath);
  const mime = MIME[ext] || "application/octet-stream";
  const stat = statSync(filePath);

  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
  });

  const stream = createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => {
    res.destroy();
  });
  log(req.method, pathname, 200, stat.size);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Update test server listening on http://127.0.0.1:${PORT}`);
  console.log(`Serving directory: ${ROOT}`);
  console.log(`Manifest URL for tauri.conf.json: http://127.0.0.1:${PORT}/latest.json`);
  console.log("Press Ctrl+C to stop.");
});
