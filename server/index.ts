import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import "pg";
import "redis";
import "drizzle-orm";
import "drizzle-orm/bun-sqlite";
import "nearley";
import { extractIndexColumns } from "../lib/db/pg-utils";
import { createRexaDbPiSession, streamPiResponse, type PiAgentInput, type PiSseEvent } from "../lib/ai/pi-agent";
import { getAgentSandboxCwd } from "../lib/agents/sandbox-cwd";
function log(...args: any[]) {
  let i = 0;
  const parts: string[] = [];
  while (i < args.length) {
    if (typeof args[i] === 'string' && args[i].includes('%s') && i + 1 < args.length) {
      parts.push(args[i].replace(/%s/g, () => {
        const val = args[++i];
        return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
      }));
    } else {
      parts.push(typeof args[i] === 'object' ? JSON.stringify(args[i]) : String(args[i]));
    }
    i++;
  }
  process.stderr.write(parts.join(' ') + '\n');
}

const PORT = parseInt(process.env.REXADB_SERVER_PORT || "3867", 10);

// In dev mode, default DB to project root (matching Electron main.js behavior)
if (!process.env.REXADB_USER_DATA_DIR) {
  process.env.REXADB_USER_DATA_DIR = process.cwd();
}

// Log to a known-writable location so we can always find it
const LOG_FILE = path.join(os.tmpdir(), "rexadb-server.log");
function logToFile(...args: unknown[]) {
  try {
    const line = `[${new Date().toISOString()}] ${args.map(a => String(a)).join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}
logToFile("=== server startup ===");
logToFile("cwd:", process.cwd());
logToFile("REXADB_USER_DATA_DIR:", process.env.REXADB_USER_DATA_DIR);
logToFile("HOME:", process.env.HOME);
logToFile("USERPROFILE:", process.env.USERPROFILE);
log("[rexadb:snapshot] Server startup — DB path:", process.env.REXADB_USER_DATA_DIR
  ? `${process.env.REXADB_USER_DATA_DIR}/sqlite.db`
  : `${process.cwd()}/sqlite.db`);


const app = express();

// Restrict CORS to localhost origins — this is a local sidecar, not a public API
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'tauri://localhost',
  'http://tauri.localhost',
  ...(process.env.REXADB_CORS_ORIGINS ? process.env.REXADB_CORS_ORIGINS.split(',').map(s => s.trim()) : []),
];

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Tauri)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn(`[cors] Blocked request from origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'User-Agent'],
});

app.use(corsMiddleware);

// Limit JSON body to 1MB (reduced from 50MB to prevent memory exhaustion)
app.use(express.json({ limit: "1mb" }));
// Strip trailing slashes so /api/agents and /api/agents/ both work
app.use((req, _res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    const qs = req.url.slice(req.path.length);
    req.url = req.path.slice(0, -1) + (qs || '');
  }
  next();
});

// Simple API key authentication (allows unauthenticated health checks)
const API_KEY = process.env.REXADB_API_KEY || '';

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Health endpoint is public
  if (req.path === '/health') return next();
  
  // Skip auth for static/studio paths
  if (req.path.startsWith('/studio/')) return next();
  
  // If no API key is configured, skip auth (dev mode)
  if (!API_KEY) return next();
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Provide Authorization: Bearer <token> header.' });
  }
  next();
}

app.use(authMiddleware);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", port: PORT });
});

// Supabase Management API proxy (avoids CORS in the browser)
app.all("/api/supabase-mgmt/proxy/*", async (req, res) => {
  try {
    const targetPath = (req.params as any)[0];
    const qs = Object.keys(req.query).length
      ? "?" + new URLSearchParams(req.query as Record<string, string>).toString()
      : "";
    const targetUrl = `https://api.supabase.com/${targetPath}${qs}`;
    const headers: Record<string, string> = {
      "User-Agent": "supabase-cli",
    };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers["user-agent"]) headers["User-Agent"] = req.headers["user-agent"];
    if (req.method !== "GET" && req.method !== "HEAD") {
      headers["Content-Type"] = req.headers["content-type"] || "application/json";
    }
    const fetchInit: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      fetchInit.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(targetUrl, fetchInit);
    const text = await upstream.text();
    res.status(upstream.status);
    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (e: any) {
    res.status(502).json({ success: false, error: e.message });
  }
});

// SpacetimeDB management/auth API proxy (avoids CORS in the browser).
// The SpacetimeDB CLI talks to these endpoints directly with reqwest; the
// webview can't because of CORS. The target host comes from ?host= — the
// login flow targets spacetimedb.com, while database listing targets the
// cloud host (customizable like `spacetime server add` in the CLI).
app.all("/api/spacetimedb-mgmt/proxy/*", async (req, res) => {
  try {
    const targetPath = (req.params as any)[0];
    const host = String(req.query.host || "spacetimedb.com");
    // Cloud/maincloud hosts speak TLS; loopback/self-hosted servers usually
    // speak plain HTTP. Let an explicit http:// prefix win, then sniff.
    const explicitProto = /^https?:\/\//i.test(host);
    const cleanHost = host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (!cleanHost || /[/?#@]/.test(cleanHost)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid proxy host" });
    }
    const isLoopback =
      /^localhost([:\/]|$)/i.test(cleanHost) ||
      /^127\.0\.0\.1([:\/]|$)/.test(cleanHost) ||
      /^\[?::1\]([:\/]|$)/.test(cleanHost);
    const protocol = explicitProto
      ? host.match(/^https:\/\//i)
        ? "https"
        : "http"
      : isLoopback
        ? "http"
        : "https";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (k === "host") continue;
      if (typeof v === "string") params.set(k, v);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const targetUrl = `${protocol}://${cleanHost}/${targetPath}${qs}`;
    const headers: Record<string, string> = {
      "User-Agent": "spacetime-cli",
    };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers["user-agent"]) headers["User-Agent"] = req.headers["user-agent"];
    const hasBody =
      req.body &&
      typeof req.body === "object" &&
      Object.keys(req.body).length > 0;
    if (req.method !== "GET" && req.method !== "HEAD" && hasBody) {
      headers["Content-Type"] = req.headers["content-type"] || "application/json";
    }
    const fetchInit: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== "GET" && req.method !== "HEAD" && hasBody) {
      fetchInit.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(targetUrl, fetchInit);
    const text = await upstream.text();
    res.status(upstream.status);
    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (e: any) {
    res.status(502).json({ success: false, error: e.message });
  }
});

// Load actions-core at module init — forces Bun to bundle it and all static deps
const actionsCore = require("../lib/db/actions-core");
const mod = actionsCore;

// --- API Routes ---

// Connections
app.get("/api/connections", async (req, res) => {
  try {
    const workspaceUrl = req.query.workspace as string | undefined;
    const result = await mod.getConnections(workspaceUrl || undefined);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Connection groups (MUST be before /:id routes to avoid param capture)
app.get("/api/connections/groups", async (_req, res) => {
  try {
    const groups = await mod.listConnectionGroups();
    res.json({ success: true, groups });
  } catch (e: any) {
    res.json({ success: false, error: e.message, groups: [] });
  }
});

app.post("/api/connections/groups/add", simplePostRoute(body => mod.addConnectionGroup(body.folderName)));

app.post("/api/connections/groups/rename", simplePostRoute(body => mod.renameConnectionGroup(body.oldName, body.newName)));

app.post("/api/connections/groups/delete", simplePostRoute(body => mod.deleteConnectionGroup(body.folderName)));

app.get("/api/connections/:id", async (req, res) => {
  try {
    const result = await mod.getConnection(Number(req.params.id));
    res.json({ success: true, data: result || null });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/connections", async (req, res) => {
  try {
    const { name, connectionString, connectionType, environment, color, groups, group, isFavorite } = req.body;
    const resolvedGroups = Array.isArray(groups) ? groups : (group ? [group] : []);
    const result = await mod.addConnection(name, connectionString, connectionType, {
      environment, color, groups: resolvedGroups, group: resolvedGroups[0] || null, isFavorite
    });
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.put("/api/connections/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await mod.updateConnection(id, req.body);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/api/connections/workspace", async (_req, res) => {
  try {
    const result = await mod.deleteConnectionsByPrefix("workspace:");
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/api/connections/:id", async (req, res) => {
  try {
    const result = await mod.deleteConnection(Number(req.params.id));
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/connections/test", async (req, res) => {
  try {
    const { connectionString, connectionType } = req.body;
    logToFile("POST /api/connections/test body keys:", Object.keys(req.body).join(","));
    logToFile("POST /api/connections/test connectionType:", connectionType, "connectionString:", String(connectionString).slice(0, 100));
    const result = await mod.testConnection(connectionString, connectionType);
    logToFile("POST /api/connections/test result success:", result.success, "error:", result.error);
    res.json(result);
  } catch (e: any) {
    logToFile("testConnection error:", e.message || e.code || String(e));
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/connections/reorder", simplePostRoute(body => mod.reorderConnections(body.orderedIds)));

// SQL query execution
app.post("/api/sql/run", async (req, res) => {
  try {
    const { connectionString, query, params, options } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.runQuery(connectionString, query, params || [], options || {});
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/sql/cancel", async (req, res) => {
  try {
    const { connectionString, queryId } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.cancelRunningQuery(connectionString, queryId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Schema & tables
app.post("/api/schema", async (req, res) => {
  try {
    const { connectionString, options } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.fetchSchemas(connectionString, options);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/tables", async (req, res) => {
  try {
    const { connectionString, schema, options } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.fetchTables(connectionString, schema, options);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/tables-with-columns", async (req, res) => {
  try {
    const { connectionString, options } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.fetchAllTablesWithColumns(connectionString, options);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/tables/search-all", async (req, res) => {
  try {
    const { searchAllTables } = await import("../lib/db/actions");
    const { connectionString, searchTerm, schema, connectionType } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await searchAllTables(connectionString, searchTerm, { schema, connectionType });
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Search index routes (local SQLite cache for universal search)
app.post("/api/search-index/query", dynamicPostRoute("../lib/db/search-index-actions", (body, m) => m.searchLocalIndex(body.connectionString, body.term)));

app.post("/api/search-index/save", dynamicPostRoute("../lib/db/search-index-actions", (body, m) => m.saveSearchResultsToIndex(body.connectionString, body.results)));

app.post("/api/search-index/clear", dynamicPostRoute("../lib/db/search-index-actions", (body, m) => m.clearSearchIndex(body.connectionString)));

app.post("/api/search-index/status", dynamicPostRoute("../lib/db/search-index-actions", (body, m) => m.getSearchIndexStatus(body.connectionString)));

app.post("/api/table-structure", proxyThreeArgRoute(mod.fetchTableStructure));

app.post("/api/table-foreign-keys", proxyThreeArgRoute(mod.fetchTableForeignKeys));

app.post("/api/referenced-record", async (req, res) => {
  try {
    const { connectionString, schema, table, keyValues } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.fetchReferencedRecord(connectionString, schema, table, keyValues);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/functions", proxyTwoArgRoute(mod.fetchFunctions));

app.post("/api/databases", async (req, res) => {
  try {
    const { connectionString, connectionType } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.fetchDatabases(connectionString, connectionType);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Table row operations
app.post("/api/table/update-rows", async (req, res) => {
  try {
    const { connectionString, schema, table, rows } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.updateTableRows(connectionString, schema, table, rows);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/table/delete-rows", async (req, res) => {
  try {
    const { connectionString, schema, table, pkValues } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.deleteTableRows(connectionString, schema, table, pkValues);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Extensions, triggers, indexes, enums, etc.
app.post("/api/extensions", proxyOneArgRoute(mod.fetchExtensions));

app.post("/api/triggers", proxyTwoArgRoute(mod.fetchTriggers));

app.post("/api/enums", proxyOneArgRoute(mod.fetchEnums));

app.post("/api/indexes", proxyTwoArgRoute(mod.fetchIndexes));

app.post("/api/views", proxyTwoArgRoute(mod.fetchViews));

app.post("/api/rls-policies", async (req, res) => {
  try {
    const { connectionString, schema, table } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.fetchRlsPolicies(connectionString, schema ?? null, table ?? null);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/postgres-roles", proxyOneArgRoute(mod.fetchPostgresRoles));

app.post("/api/table-security-info", proxyTwoArgRoute(mod.fetchTableSecurityInfo));

app.post("/api/supabase-auth-users", async (req, res) => {
  try {
    if (await tryProxyDbOp(req, res)) return;
    res.json({ success: true, data: [] });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/sessions", proxyOneArgRoute(mod.fetchSessions));

app.post("/api/sessions/kill", proxyTwoArgRoute(mod.killSession));

app.post("/api/sessions/cancel-query", proxyTwoArgRoute(mod.cancelSessionQuery));

app.post("/api/locks", proxyOneArgRoute(mod.fetchLocks));

app.post("/api/db-advisor", async (req, res) => {
  try {
    const { connectionString } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.runAdvisorChecks(connectionString);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/explain-plan", async (req, res) => {
  try {
    const { connectionString, query } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.fetchExplainPlan(connectionString, query);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/backup/run", async (req, res) => {
  try {
    const { connectionString, options } = req.body;
    if (await tryProxyDbOp(req, res)) return;
    const result = await mod.runDbBackup(connectionString, options);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// User profile
app.get("/api/user/profile", async (req, res) => {
  try {
    const id = req.query.id as string | undefined;
    const getAll = req.query.getAll as string | undefined;
    if (getAll === "true") {
      const result = await mod.getAllUsers();
      return res.json(result);
    }
    const result = await mod.getStoredUserProfile(id || null);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/user/profile", simplePostRoute(mod.upsertUserProfile));

app.delete("/api/user/profile", async (req, res) => {
  try {
    const { id, all } = req.body || {};
    if (all) {
      const result = await mod.clearAllUsers();
      return res.json(result);
    }
    const result = await mod.deleteUserProfile(id);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Error logging
app.post("/api/errors/log", async (req, res) => {
  try {
    const { errorType, message, stack, url, componentStack, metadata, appVersion, os } = req.body || {};
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > 51200) {
      logToFile("[error-logger] payload too large:", bodySize, "bytes");
      return res.json({ success: false, error: "Payload too large" });
    }
    logToFile(`[error-logger] type=${errorType} msg=${message?.slice(0, 200)} url=${url}`);
    const result = await mod.logAppError({
      errorType: errorType || "unknown",
      message: message || null,
      stack: stack || null,
      url: url || null,
      componentStack: componentStack || null,
      metadata: metadata || {},
      appVersion: appVersion || null,
      os: os || null,
    });
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Settings
app.get("/api/app-font", simpleGetRoute(mod.getAppFontFamily));

app.post("/api/app-font", simplePostRoute(body => mod.saveAppFontFamily(body.fontFamily)));

app.get("/api/app-theme", simpleGetRoute(mod.getGlobalAppThemeSettings));

app.post("/api/app-theme", simplePostRoute(mod.saveGlobalAppThemeSettings));

app.get("/api/editor-theme", simpleGetRoute(mod.getGlobalEditorThemeSettings));

app.post("/api/editor-theme", simplePostRoute(mod.saveGlobalEditorThemeSettings));

app.get("/api/studio-settings", simpleGetRoute(mod.getGlobalStudioSettings));

app.post("/api/studio-settings", simplePostRoute(mod.saveGlobalStudioSettings));

// Settings migration
app.get("/api/settings/migration-status", async (_req, res) => {
  try {
    const result = await mod.isMigrationNeeded();
    res.json({ success: true, data: { migrationNeeded: result } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/settings/migrate", async (_req, res) => {
  try {
    const result = await mod.migrateSettingsFromSqlite();
    res.json({ success: result.done, data: result, error: result.error });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/settings/clear-migrated", async (_req, res) => {
  try {
    await mod.clearMigratedSqliteSettings();
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Snapshot create stream (SSE)
app.post("/api/snapshots/create-stream", async (req, res) => {
  const { handleSnapshotCreateStream } = await import("./snapshot-stream");
  await handleSnapshotCreateStream(req, res);
});

// Generic actions dispatch (for all the misc actions)
app.post("/api/actions/:action", async (req, res) => {
  try {
    const { action } = req.params;
    const { args } = req.body || {};

    const func = (mod as any)[action];
    if (typeof func !== "function") {
      return res.json({ success: false, error: `Unknown action: ${action}` });
    }

    const result = await func(...(Array.isArray(args) ? args : []));
    res.json(result || { success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Studio routes
app.get("/studio/:connectionId/folders", studioGetRoute(mod.getStudioFolders));
app.post("/studio/:connectionId/folders", studioPostRoute(mod.saveStudioFolders));

app.get("/studio/:connectionId/snippets", async (req, res) => {
  try {
    const connectionId = Number(req.params.connectionId);
    const result = await mod.getStudioSnippets(connectionId);
    log("[rexadb:snapshot] Server getStudioSnippets for", connectionId, {
      success: result?.success,
      count: result?.data?.length ?? 0,
      ids: (result?.data ?? []).map((s: any) => s.id),
      names: (result?.data ?? []).map((s: any) => s.name),
    });
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/studio/:connectionId/snippets", async (req, res) => {
  try {
    const connectionId = Number(req.params.connectionId);
    const body = req.body;
    log("[rexadb:snapshot] Server saveStudioSnippets received", {
      connectionId,
      snippetCount: Array.isArray(body) ? body.length : typeof body,
      snippetIds: Array.isArray(body) ? body.map((s: any) => s?.id) : [],
      snippetNames: Array.isArray(body) ? body.map((s: any) => s?.name) : [],
    });
    const result = await mod.saveStudioSnippets(connectionId, body);
    log("[rexadb:snapshot] Server saveStudioSnippets result", result);
    res.json(result);
  } catch (e: any) {
    console.error("[rexadb:snapshot] Server saveStudioSnippets error", e);
    res.json({ success: false, error: e.message });
  }
});

app.get("/studio/:connectionId/history", studioGetRoute(mod.getStudioHistory));
app.post("/studio/:connectionId/history", studioPostRoute(mod.saveStudioHistory));

app.post("/studio/:connectionId/history/entry", async (req, res) => {
  try {
    const result = await mod.insertHistoryEntry(Number(req.params.connectionId), req.body);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/studio/:connectionId/history", async (req, res) => {
  try {
    const result = await mod.clearStudioHistory(Number(req.params.connectionId));
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/studio/:connectionId/tags", studioGetRoute(mod.getStudioTags));
app.post("/studio/:connectionId/tags", studioPostRoute(mod.saveStudioTags));

app.get("/studio/:connectionId/table-tags", studioGetRoute(mod.getStudioTableTags));
app.post("/studio/:connectionId/table-tags", studioPostRoute(mod.saveStudioTableTags));

app.get("/studio/:connectionId/tabs", studioGetRoute(mod.getStudioTabs));
app.post("/studio/:connectionId/tabs", studioPostRoute(mod.saveStudioTabs));

app.get("/studio/:connectionId/settings", studioGetRoute(mod.getStudioSettings));
app.post("/studio/:connectionId/settings", studioPostRoute(mod.saveStudioSettings));

app.get("/studio/:connectionId/dashboards", studioGetRoute(mod.getStudioDashboards));
app.post("/studio/:connectionId/dashboards", studioPostRoute(mod.saveStudioDashboards));

app.get("/studio/:connectionId/bootstrap", async (req, res) => {
  try {
    const rawId = req.params.connectionId;
    const numericId = Number(rawId);
    const requestedSchema = req.query.s as string | undefined;
    const result = await mod.getStudioBootstrap(numericId, requestedSchema || null);

    // If bootstrap found a connection locally, return it as-is
    if (result?.success && result.data?.connection) {
      return res.json(result);
    }

    // Otherwise, if studio is configured, fetch from studio API
    if (studioConfig && rawId) {
      const { studioUrl, studioToken, userId } = studioConfig;
      const connRes = await fetch(`${studioUrl.replace(/\/+$/, "")}/api/connections/${rawId}`, {
        headers: { Authorization: `Bearer ${studioToken}` },
      });
      const connData = await connRes.json();
      if (connData?.data) {
        const cd = connData.data;
        const connStr = `workspace:${rawId}`;
        const connType = cd.type || "postgresql";
        wsConnTypes.set(rawId, connType === "mysql" ? "mysql" : "postgres");
        const fakeConn = {
          id: numericId || 0,
          name: cd.name || "Workspace Connection",
          connectionString: connStr,
          connectionType: connType,
          createdAt: new Date().toISOString(),
          sortOrder: Date.now(),
        };
        // Save to local DB so sidecar lookups (folders, snippets, etc.) resolve
        await mod.addConnection(fakeConn.name, fakeConn.connectionString).catch(() => {});
        return res.json({
          success: true,
          data: {
            connection: fakeConn,
            tabs: [],
            settings: null,
            schemas: [] as string[],
            selectedSchema: null as string | null,
            tables: [] as string[],
          },
        });
      }
    }
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// AI routes (basic - list chats, get messages)
app.get("/api/ai/chats", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = await mod.listAiChats(connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/ai/settings", simpleGetRoute(mod.getGlobalAiSettings));

app.get("/api/ai/providers", simpleGetRoute(async () => {
  const { listAiProviderCatalog } = await import("../lib/ai/pi-provider-catalog");
  return listAiProviderCatalog();
}));

app.post("/api/ai/settings", simplePostRoute(body => mod.saveGlobalAiSettings(body.settings)));

app.get("/api/keybindings", simpleGetRoute(async () => {
  const { getKeybindings } = await import("../lib/db/keybindings-store");
  return getKeybindings();
}));

app.post("/api/keybindings", simplePostRoute(async (body) => {
  const { saveKeybindings } = await import("../lib/db/keybindings-store");
  return saveKeybindings(body.keybindings);
}));

// JSON-file-backed chat storage for Studio AI assistant
import {
  saveChatMessages as jsonSaveChat,
  loadChatMessages as jsonLoadChat,
  listChats as jsonListChats,
  deleteChat as jsonDeleteChat,
} from "../lib/db/chat-json-storage";

app.get("/api/studio/chats", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = jsonListChats(connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/studio/chats/:chatId", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = jsonLoadChat(req.params.chatId, connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/studio/chats/:chatId/save", async (req, res) => {
  try {
    const { connectionId, title, messages } = req.body;
    const result = jsonSaveChat(req.params.chatId, Number(connectionId), title || "Chat", messages || []);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/api/studio/chats/:chatId", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = jsonDeleteChat(req.params.chatId, connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Stub routes for endpoints not yet implemented on the sidecar ---

// Studio config (in-memory for local usage)
let studioConfig: { studioUrl: string; studioToken: string; userId: string } | null = null;

// Workspace connection helpers — proxy DB operations through studio API
// All SQL executes via POST /api/connections/<uuid>/query on the Studio,
// which enforces RBAC. The sidecar NEVER holds credentials.
function isWsConnection(cs: string): boolean {
  return typeof cs === "string" && cs.startsWith("workspace:");
}

function getWsConnId(cs: string): string | null {
  if (!cs || !cs.startsWith("workspace:")) return null;
  return cs.slice("workspace:".length);
}

// Cache connection type (postgres|mysql) per workspace UUID
const wsConnTypes = new Map<string, string>();

async function apiQuery(wsId: string, sql: string, params: any[] = []): Promise<any> {
  if (!studioConfig) return { error: "Studio not configured" };
  const { studioUrl, studioToken } = studioConfig;
  const url = `${studioUrl.replace(/\/+$/, "")}/api/connections/${wsId}/query`;
  log("[apiQuery] POST", url, "SQL:", sql.substring(0, 120));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${studioToken}` },
    body: JSON.stringify({ sql, params }),
  });
  const text = await res.text();
  log("[apiQuery] status:", res.status, "body:", text.substring(0, 800));
  try { return JSON.parse(text); } catch { return { error: text || "Empty response" }; }
}

async function queryAndReturn(wsId: string, sql: string, params?: any[]) {
  const qr = await apiQuery(wsId, sql, params);
  if (qr.error) return { success: false, error: qr.error };
  return { success: true, data: qr.rows || [] };
}

async function proxyDbOp(apiPath: string, body: any): Promise<any> {
  if (!studioConfig) return { success: false, error: "Studio not configured" };
  const wsId = getWsConnId(body?.connectionString);
  if (!wsId) return { success: false, error: "Invalid workspace connection string" };

  const connType = wsConnTypes.get(wsId) || "postgres";
  log("[proxyDbOp] enter apiPath=%s wsId=%s connType=%s", apiPath, wsId, connType);
  const P = (i: number) => connType === "mysql" ? "?" : `$${i}`;

  try {
    switch (apiPath) {

      case "sql/run": {
        if (!body.query) return { success: false, error: "No query provided" };
        const qr = await apiQuery(wsId, body.query, body.params || []);
        if (qr.error) return { success: false, error: qr.error };
        return {
          success: true,
          data: {
            rows: qr.rows || [],
            fields: (qr.fields || []).map((f: any) => typeof f === "string" ? { name: f } : f),
            rowCount: qr.rowCount ?? 0,
            executionTime: qr.duration ?? 0,
          },
        };
      }

      case "sql/cancel":
        return { success: true };

      case "schema": {
        log("[proxyDbOp] schema: wsId=%s connType=%s", wsId, connType);
        const sql = connType === "mysql"
          ? "SELECT SCHEMA_NAME AS schema_name FROM information_schema.schemata ORDER BY SCHEMA_NAME"
          : "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','pg_catalog') AND schema_name NOT LIKE 'pg_toast%' ORDER BY schema_name";
        const qr = await apiQuery(wsId, sql);
        if (qr.error) return { success: false, error: qr.error };
        const data = (qr.rows || []).map((r: any) => r.schema_name);
        log("[proxyDbOp] schema result: success=true data.length=%d", data.length);
        return { success: true, data };
      }

      case "tables": {
        const schema = body.schema || "public";
        const sql = connType === "mysql"
          ? `SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE TABLE_SCHEMA = ${P(1)} ORDER BY TABLE_NAME`
          : `SELECT table_name FROM information_schema.tables WHERE table_schema = ${P(1)} ORDER BY table_name`;
        const qr = await apiQuery(wsId, sql, [schema]);
        if (qr.error) return { success: false, error: qr.error };
        return { success: true, data: (qr.rows || []).map((r: any) => r.table_name) };
      }

      case "tables-with-columns": {
        const sql = connType === "mysql" ? `
          SELECT cols.TABLE_SCHEMA AS table_schema, cols.TABLE_NAME AS table_name,
            cols.COLUMN_NAME AS column_name, cols.DATA_TYPE AS data_type,
            cols.IS_NULLABLE AS is_nullable, cols.COLUMN_DEFAULT AS column_default,
            IF(cols.COLUMN_KEY='PRI',TRUE,FALSE) AS is_primary,
            ref.REFERENCED_TABLE_SCHEMA AS referenced_table_schema,
            ref.REFERENCED_TABLE_NAME AS referenced_table_name,
            ref.REFERENCED_COLUMN_NAME AS referenced_column_name
          FROM information_schema.COLUMNS cols
          LEFT JOIN information_schema.KEY_COLUMN_USAGE ref
            ON cols.TABLE_SCHEMA = ref.TABLE_SCHEMA AND cols.TABLE_NAME = ref.TABLE_NAME
            AND cols.COLUMN_NAME = ref.COLUMN_NAME AND ref.REFERENCED_TABLE_NAME IS NOT NULL
          WHERE cols.TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')
          ORDER BY cols.TABLE_SCHEMA, cols.TABLE_NAME, cols.ORDINAL_POSITION
        ` : `
          SELECT cols.table_schema, cols.table_name, cols.column_name, cols.data_type,
            cols.is_nullable, cols.column_default,
            (SELECT count(*) FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu2
                ON tc.constraint_name = kcu2.constraint_name
              WHERE tc.constraint_type = 'PRIMARY KEY'
                AND kcu2.table_schema = cols.table_schema
                AND kcu2.table_name = cols.table_name
                AND kcu2.column_name = cols.column_name) > 0 AS is_primary,
            kcu.referenced_table_schema, kcu.referenced_table_name, kcu.referenced_column_name
          FROM information_schema.columns cols
          LEFT JOIN (
            SELECT kcu1.table_schema, kcu1.table_name, kcu1.column_name,
              kcu2.table_schema AS referenced_table_schema,
              kcu2.table_name AS referenced_table_name,
              kcu2.column_name AS referenced_column_name
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu1
              ON rc.constraint_name = kcu1.constraint_name
              AND rc.constraint_schema = kcu1.constraint_schema
            JOIN information_schema.key_column_usage kcu2
              ON rc.unique_constraint_name = kcu2.constraint_name
              AND rc.unique_constraint_schema = kcu2.constraint_schema
              AND kcu1.ordinal_position = kcu2.ordinal_position
          ) kcu ON cols.table_schema = kcu.table_schema
            AND cols.table_name = kcu.table_name
            AND cols.column_name = kcu.column_name
          WHERE cols.table_schema NOT IN ('information_schema','pg_catalog')
          ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position
        `;
        return await queryAndReturn(wsId, sql);
      }

      case "table/update-rows": {
        return { success: false, error: "Row updates are not supported for workspace connections via the sidecar proxy. Execute UPDATE SQL directly." };
      }

      case "table/delete-rows": {
        return { success: false, error: "Row deletion is not supported for workspace connections via the sidecar proxy. Execute DELETE SQL directly." };
      }

      case "extensions": {
        const sql = `
          SELECT ext.name, ext.default_version, ext.installed_version,
            ext.comment, ns.nspname AS installed_schema,
            details.schema AS default_schema,
            array_to_string(details.requires, ', ') AS requires,
            details.trusted, details.relocatable, details.superuser,
            array_to_string(
              ARRAY(
                SELECT version_item.version
                FROM pg_available_extension_versions AS version_item
                WHERE version_item.name = ext.name
                ORDER BY version_item.version DESC
              ),
              ', '
            ) AS available_versions
          FROM pg_available_extensions AS ext
          LEFT JOIN pg_extension AS installed_ext
            ON installed_ext.extname = ext.name
          LEFT JOIN pg_namespace AS ns
            ON ns.oid = installed_ext.extnamespace
          LEFT JOIN pg_available_extension_versions AS details
            ON details.name = ext.name
           AND details.version = COALESCE(ext.installed_version, ext.default_version)
          ORDER BY ext.name;
        `;
        const qr = await apiQuery(wsId, sql);
        if (qr.error) return { success: false, error: qr.error };
        return { success: true, data: qr.rows || [] };
      }

      case "triggers": {
        const schema = body.schema || "public";
        const sql = `
          SELECT trigger_schema AS schema, trigger_name AS name,
            event_object_table AS table_name, action_timing AS timing,
            event_manipulation AS event, action_statement AS definition
          FROM information_schema.triggers
          WHERE trigger_schema = ${P(1)}
          ORDER BY event_object_table, trigger_name
        `;
        return await queryAndReturn(wsId, sql, [schema]);
      }

      case "enums": {
        const sql = `
          SELECT n.nspname AS schema, t.typname AS name,
            e.enumlabel AS value, e.enumsortorder AS sort_order
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          ORDER BY n.nspname, t.typname, e.enumsortorder
        `;
        const qr = await apiQuery(wsId, sql);
        if (qr.error) return { success: false, error: qr.error };
        const rows = qr.rows || [];
        const enumsMap: Record<string, { schema: string; name: string; values: string[] }> = {};
        for (const row of rows) {
          const key = `${row.schema}.${row.name}`;
          if (!enumsMap[key]) enumsMap[key] = { schema: row.schema, name: row.name, values: [] };
          enumsMap[key].values.push(row.value);
        }
        return { success: true, data: Object.values(enumsMap) };
      }

      case "indexes": {
        const schema = body.schema || "public";
        const sql = `
          SELECT schemaname AS schema, tablename AS table_name,
            indexname AS name, indexdef AS definition,
            CASE WHEN indexdef LIKE 'CREATE UNIQUE INDEX%' THEN true ELSE false END AS is_unique
          FROM pg_indexes
          WHERE schemaname = ${P(1)}
          ORDER BY tablename, indexname
        `;
        const qr = await apiQuery(wsId, sql, [schema]);
        if (qr.error) return { success: false, error: qr.error };
        const raw = qr.rows || [];
        const data = raw.map((row: any) => ({
          ...row,
          columns: extractIndexColumns(row.definition),
        }));
        return { success: true, data };
      }

      case "views": {
        const s = body.schema || "public";
        const sql = `
          SELECT table_name AS name
          FROM information_schema.views
          WHERE table_schema = ${P(1)}
          UNION
          SELECT matviewname AS name
          FROM pg_matviews
          WHERE schemaname = ${P(1)}
          ORDER BY name
        `;
        const qr = await apiQuery(wsId, sql, [s]);
        if (qr.error) return { success: false, error: qr.error };
        const data = qr.rows.map((r: any) => r.name);
        return { success: true, data };
      }

      case "rls-policies": {
        const rlsSchema = body.schema || null;
        const rlsTable = body.table || null;
        const sql = `
          SELECT
            p.schemaname AS schema,
            p.tablename AS table_name,
            p.policyname AS name,
            p.permissive AS permissive,
            p.roles AS roles,
            p.cmd AS command,
            p.qual AS using_expression,
            p.with_check AS with_check_expression,
            c.relrowsecurity AS rls_enabled,
            c.relforcerowsecurity AS rls_forced
          FROM pg_policies p
          JOIN pg_namespace n ON n.nspname = p.schemaname
          JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = n.oid
          WHERE p.schemaname NOT IN ('information_schema', 'pg_catalog')
            AND (${P(1)}::text IS NULL OR p.schemaname = ${P(1)})
            AND (${P(2)}::text IS NULL OR p.tablename = ${P(2)})
          ORDER BY p.schemaname, p.tablename, p.policyname
        `;
        const qr = await apiQuery(wsId, sql, [rlsSchema, rlsTable]);
        if (qr.error) return { success: false, error: qr.error };
        return { success: true, data: qr.rows || [] };
      }

      case "postgres-roles": {
        const sql = `
          SELECT rolname AS name
          FROM pg_roles
          WHERE rolname !~ '^pg_'
          ORDER BY rolname
        `;
        const qr = await apiQuery(wsId, sql);
        if (qr.error) return { success: false, error: qr.error };
        const data = qr.rows.map((r: any) => String(r.name || "").trim()).filter(Boolean);
        return { success: true, data };
      }

      case "table-security-info": {
        const secSchema = body.schema || "public";
        const sql = `
          SELECT
            c.relname AS table_name,
            c.relrowsecurity AS rls_enabled,
            c.relforcerowsecurity AS rls_forced,
            COUNT(p.policyname) AS policy_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
          WHERE n.nspname = ${P(1)}
            AND c.relkind IN ('r', 'p')
          GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
          ORDER BY c.relname
        `;
        const qr = await apiQuery(wsId, sql, [secSchema]);
        if (qr.error) return { success: false, error: qr.error };
        return { success: true, data: qr.rows || [] };
      }

      case "supabase-auth-users": {
        const sql = `
          SELECT u.id::text AS id, u.email, u.phone, u.role, u.created_at,
            u.raw_app_meta_data, u.raw_user_meta_data,
            COALESCE(string_agg(DISTINCT i.provider, ', ') FILTER (WHERE i.provider IS NOT NULL),
              CASE WHEN u.encrypted_password IS NOT NULL THEN 'email' ELSE NULL END) AS identities
          FROM auth.users u
          LEFT JOIN auth.identities i ON i.user_id = u.id
          GROUP BY u.id
          ORDER BY u.created_at DESC
        `;
        const qr = await apiQuery(wsId, sql);
        if (qr.error) return { success: false, error: qr.error };
        return { success: true, data: qr.rows || [] };
      }

      default:
        return { success: false, error: `Unsupported workspace operation: ${apiPath}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Proxy request failed" };
  }
}

// Middleware: proxy DB operation if workspace connection
async function tryProxyDbOp(req: any, res: any): Promise<boolean> {
  const cs = req.body?.connectionString;
  log("[tryProxyDbOp] checking cs=%s", cs);
  if (isWsConnection(cs)) {
    log("[tryProxyDbOp] intercepting", req.path);
    if (!studioConfig) {
      res.json({ success: false, error: "Workspace connection requires studio to be configured. Connect to studio in Settings first." });
      return true;
    }
    const apiPath = req.path.replace("/api/", "");
    res.json(await proxyDbOp(apiPath, req.body));
    return true;
  }
  return false;
}

// ─── Route-handler factories (eliminate try/catch/tryProxy boilerplate) ──────
type Handler = (req: any, res: any) => Promise<void>;

/** GET /studio/:connectionId/X — extract connectionId, call mod.fn(id) */
function studioGetRoute(fn: (id: number) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(Number(req.params.connectionId)));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /studio/:connectionId/X — extract connectionId + body, call mod.fn(id, body) */
function studioPostRoute(fn: (id: number, body: any) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(Number(req.params.connectionId), req.body));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** GET /api/X — zero-arg mod.fn() */
function simpleGetRoute(fn: () => Promise<any>): Handler {
  return async (_req, res) => {
    try {
      res.json(await fn());
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — tryProxyDbOp + extract connectionString, call mod.fn(cs) */
function proxyOneArgRoute(fn: (cs: string) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      if (await tryProxyDbOp(req, res)) return;
      res.json(await fn(req.body.connectionString));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — tryProxyDbOp + extract connectionString, schema */
// fallow-ignore-next-line code-duplication
function proxyTwoArgRoute(fn: (cs: string, schema: string) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      if (await tryProxyDbOp(req, res)) return;
      res.json(await fn(req.body.connectionString, req.body.schema));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — tryProxyDbOp + extract connectionString, schema, table */
// fallow-ignore-next-line code-duplication
function proxyThreeArgRoute(fn: (cs: string, schema: string, table: string) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      if (await tryProxyDbOp(req, res)) return;
      res.json(await fn(req.body.connectionString, req.body.schema, req.body.table));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — pass req.body to fn, return result */
function simplePostRoute(fn: (body: any) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(req.body));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — dynamic import, then call fn(body, importedModule) */
function dynamicPostRoute(importPath: string, fn: (body: any, mod: any) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      const m = await import(importPath);
      res.json(await fn(req.body, m));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** Dynamic-import the workflow dependencies (db, schema, drizzle-orm, ensureCoreTables) */
async function getWorkflowDeps() {
  const { db } = await import("../lib/db/index");
  const { workflows, workflowRuns } = await import("../lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");
  const { ensureCoreTables } = await import("../lib/db/ensure-core-tables");
  await ensureCoreTables();
  return { db, workflows, workflowRuns, eq, desc };
}

app.post("/api/studio/ws-type", (req, res) => {
  const { wsId, connType } = req.body || {};
  if (wsId && connType) {
    wsConnTypes.set(wsId, connType);
    res.json({ success: true });
  } else {
    res.json({ success: false, error: "Missing wsId or connType" });
  }
});

app.get("/api/studio-config", async (_req, res) => {
  if (studioConfig) {
    res.json({ success: true, data: studioConfig });
    return;
  }
  try {
    const { getStudioBackendConfig } = await import("../lib/db/actions");
    const result = await getStudioBackendConfig();
    if (result.success && result.data) {
      studioConfig = result.data;
      res.json({ success: true, data: result.data });
      return;
    }
  } catch (e) {
    logToFile("Failed to load studio config from DB:", e);
  }
  res.json({ success: false, data: null });
});

app.post("/api/studio-config", async (req, res) => {
  const { studioUrl, studioToken, userId } = req.body || {};
  if (studioUrl && studioToken && userId) {
    studioConfig = { studioUrl, studioToken, userId };
    try {
      const { saveStudioBackendConfig } = await import("../lib/db/actions");
      await saveStudioBackendConfig(studioConfig);
    } catch (e) {
      logToFile("Failed to save studio config to DB:", e);
    }
  }
  res.json({ success: true });
});

app.delete("/api/studio-config", async (_req, res) => {
  studioConfig = null;
  try {
    const { clearStudioBackendConfig } = await import("../lib/db/actions");
    await clearStudioBackendConfig();
  } catch (e) {
    logToFile("Failed to clear studio config from DB:", e);
  }
  res.json({ success: true });
});

// Multi-workspace support
app.get("/api/workspaces", async (_req, res) => {
  try {
    const { getWorkspaceList } = await import("../lib/db/actions");
    const result = await getWorkspaceList();
    res.json({ success: true, data: result.data });
  } catch (e: any) {
    res.json({ success: false, data: [], error: e.message });
  }
});

app.put("/api/workspaces/activate", async (req, res) => {
  try {
    const { studioUrl } = req.body || {};
    if (!studioUrl) {
      res.json({ success: false, error: "Missing studioUrl" });
      return;
    }
    const { getWorkspaceList } = await import("../lib/db/actions");
    const list = await getWorkspaceList();
    const workspace = list.data.find((w: any) => w.studioUrl === studioUrl);
    if (!workspace) {
      res.json({ success: false, error: "Workspace not found" });
      return;
    }
    studioConfig = { studioUrl: workspace.studioUrl, studioToken: workspace.studioToken, userId: workspace.userId };
    const { saveStudioBackendConfig } = await import("../lib/db/actions");
    await saveStudioBackendConfig(studioConfig);
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.put("/api/workspaces/deactivate", async (_req, res) => {
  try {
    if (studioConfig) {
      const { clearStudioBackendConfig } = await import("../lib/db/actions");
      await clearStudioBackendConfig();
      studioConfig = null;
    }
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/workspaces", async (req, res) => {
  try {
    const { studioUrl, studioToken, userId, name } = req.body || {};
    if (!studioUrl || !studioToken || !userId) {
      res.json({ success: false, error: "Missing required fields" });
      return;
    }
    const { getWorkspaceList, saveWorkspaceList } = await import("../lib/db/actions");
    const list = await getWorkspaceList();
    const existing = list.data.findIndex((w: any) => w.studioUrl === studioUrl);
    const entry = { studioUrl, studioToken, userId, name: name || studioUrl };
    if (existing >= 0) {
      list.data[existing] = entry;
    } else {
      list.data.push(entry);
    }
    await saveWorkspaceList(list.data);
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/api/workspaces", async (req, res) => {
  try {
    const { studioUrl } = req.body || {};
    if (!studioUrl) {
      res.json({ success: false, error: "Missing studioUrl" });
      return;
    }
    const { getWorkspaceList, saveWorkspaceList } = await import("../lib/db/actions");
    const list = await getWorkspaceList();
    list.data = list.data.filter((w: any) => w.studioUrl !== studioUrl);
    await saveWorkspaceList(list.data);
    if (studioConfig?.studioUrl === studioUrl) {
      studioConfig = null;
      const { clearStudioBackendConfig } = await import("../lib/db/actions");
      await clearStudioBackendConfig();
    }
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Billing / entitlement
app.get("/api/billing/entitlement", async (req, res) => {
  try {
    const { getEntitlementPrivateKeyPem, signEntitlementPayload } = await import("../lib/billing/entitlement-server");
    const { DEFAULT_FREE_MAX_CONNECTIONS, DEFAULT_FREE_MAX_WORKSPACES, ENTITLEMENT_CACHE_TTL_MS } = await import("../lib/billing/entitlement-constants");

    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const userId = token || "local";
    const privateKey = getEntitlementPrivateKeyPem();

    if (!privateKey) {
      return res.json({ success: false, error: "Entitlement signing not configured" });
    }

    const now = Date.now();
    const payload: import("../lib/billing/entitlement-types").SignedEntitlementPayload = {
      version: 1,
      userId,
      entitlementPlanCode: "free",
      lastPaidPlanCode: null,
      status: "none",
      cloudEnabled: false,
      maxConnections: DEFAULT_FREE_MAX_CONNECTIONS,
      maxWorkspaces: DEFAULT_FREE_MAX_WORKSPACES,
      accessEndsAt: null,
      graceEndsAt: null,
      updatesUntil: null,
      issuedAt: now,
      refreshAfter: now + ENTITLEMENT_CACHE_TTL_MS,
    };

    const envelope = signEntitlementPayload(payload, privateKey);
    res.json({ success: true, envelope });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Notifications
app.get("/api/notifications", (req, res) => {
  res.json({ success: true, notifications: [] });
});

app.post("/api/notifications/mark-read", (req, res) => {
  res.json({ success: true });
});

// Analytics
app.get("/api/user/analytics", async (req, res) => {
  try {
    const result = await mod.getUserAnalytics();
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/connections/:id/analytics", async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    if (isNaN(connectionId)) {
      res.json({ success: false, error: "Invalid connection ID" });
      return;
    }
    const range = req.query.range as string | undefined;
    const result = await mod.getConnectionAnalytics(connectionId, range);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Agents
app.get("/api/agents", (_req, res) => {
  res.json({ agents: [] });
});

// AI chat messages
app.get("/api/ai/chats/:chatId/messages", async (req, res) => {
  try {
    const result = await mod.getAiChatMessages(req.params.chatId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/ai/chats/:chatId/messages", async (req, res) => {
  log("[rexadb:chat] POST messages chatId=%s action=%s", req.params.chatId, req.body?.action);
  try {
    const { action, ...payload } = req.body;
    switch (action) {
      case "append": {
        const result = await mod.appendAiChatMessage({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "update_content": {
        const result = await mod.updateAiChatMessageContent({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "update_meta": {
        const result = await mod.updateAiChatMessageMeta({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "delete_after": {
        const result = await mod.deleteAiChatMessagesAfter({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "ensure": {
        const result = await mod.ensureAiChat(payload);
        return res.json(result);
      }
      default:
        return res.json({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

async function resolveAiReq(req: any, res: any) {
  const {
    provider, model, prompt, connectionString, dbType,
    selectedNamespace, lightSchemaContext,
    schemaContext: altSchemaContext, defaultSchema, apiKey: directApiKey,
  } = req.body;

  if (!provider || !model || !prompt || !connectionString || !dbType) {
    res.status(400).json({ error: "Missing required fields: provider, model, prompt, connectionString, dbType" });
    return null;
  }

  const settingsResult = await mod.getGlobalAiSettings();
  if (!settingsResult.success) {
    res.status(500).json({ error: "Failed to load AI settings." });
    return null;
  }

  const settings = settingsResult.data;

  if (directApiKey) {
    settings.providers[provider] = settings.providers[provider] || { apiKey: "", models: [] };
    settings.providers[provider].apiKey = directApiKey;
  }

  if (!settings.providers[provider] || !settings.providers[provider].apiKey.trim()) {
    res.status(400).json({ error: `AI provider "${provider}" is not configured.` });
    return null;
  }

  const schemaContext = lightSchemaContext || altSchemaContext || [];
  const namespace = selectedNamespace || defaultSchema || undefined;

  return { provider, model, prompt, connectionString, dbType, settings, schemaContext, namespace };
}

function handleSseError(error: any, label: string, res: any) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  console.error(`[${label}] error:`, message);
  if (error?.stack && !(error instanceof Error && error.message === error.stack)) {
    console.error(`[${label}] stack:`, error.stack);
  }
  if (res.headersSent) {
    res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    res.end();
  } else {
    res.status(500).json({ error: message });
  }
}

function setupSsePiAgent(req: any, res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let aborted = false;
  req.on("close", () => { aborted = true; });

  const emitSse = (event: PiSseEvent) => {
    if (aborted) return;
    switch (event.type) {
      case "step":
        res.write(`data: ${JSON.stringify({ type: "step", message: event.message })}\n\n`);
        break;
      case "assistant_delta":
        res.write(`data: ${JSON.stringify({ type: "assistant_delta", message: event.message })}\n\n`);
        break;
      case "tool_start":
        res.write(`data: ${JSON.stringify({ type: "tool_start", tool: event.tool, command: event.command })}\n\n`);
        break;
      case "tool_output":
        res.write(`data: ${JSON.stringify({ type: "tool_output", output: event.output })}\n\n`);
        break;
      case "tool_end":
        res.write(`data: ${JSON.stringify({ type: "tool_end", exitCode: event.exitCode })}\n\n`);
        break;
    }
  };

  return { aborted, emitSse };
}

// Agent / SQL stream routes
app.post("/api/agent/chat/stream", async (req, res) => {
  try {
    const { history, lightDashboardContext, lightWorkflowContext, permissionMode } = req.body;
    const resolved = await resolveAiReq(req, res);
    if (!resolved) return;
    const { provider, model, prompt, connectionString, dbType, settings, schemaContext, namespace } = resolved;
    const dashboardContext = lightDashboardContext || [];

    const { aborted, emitSse } = setupSsePiAgent(req, res);

    const piInput: PiAgentInput = {
      settings,
      provider,
      model,
      permissionMode: permissionMode || "schema_only",
      connectionString,
      dbType,
      selectedNamespace: namespace,
      schemaContext,
      dashboardContext,
      workflowContext: lightWorkflowContext || { existing: [], current: null },
      workingDirectory: getAgentSandboxCwd(),
      emitStep: (message: string) => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "step", message })}\n\n`);
        }
      },
    };

    const { session, dispose } = await createRexaDbPiSession(piInput);

    let fullText = "";
    try {
      fullText = await streamPiResponse({
        session,
        history: history || [],
        prompt,
        emit: emitSse,
        isAborted: () => aborted,
      });
    } finally {
      dispose();
    }

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: "assistant_done", message: fullText })}\n\n`);
    }
    res.end();
  } catch (error: any) {
    handleSseError(error, "agent/chat/stream", res);
  }
});

app.post("/api/agent/approval/submit", async (req, res) => {
  try {
    const { toolCallId, answers } = req.body as { toolCallId?: string; answers?: unknown };
    if (!toolCallId) {
      return res.status(400).json({ error: "toolCallId required" });
    }
    const { resolvePendingApproval } = await import("../lib/ai/pending-approvals");
    const ok = resolvePendingApproval(String(toolCallId), answers);
    if (!ok) {
      return res.status(404).json({ error: "No pending approval for this ID. It may have timed out." });
    }
    res.json({ ok: true, toolCallId });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to submit approval" });
  }
});

app.post("/api/agent/generate-dashboard/stream", async (req, res) => {
  try {
    const { permissionMode } = req.body;
    const resolved = await resolveAiReq(req, res);
    if (!resolved) return;
    const { provider, model, prompt, connectionString, dbType, settings, schemaContext, namespace } = resolved;

    const { aborted, emitSse } = setupSsePiAgent(req, res);

    const piInput: PiAgentInput = {
      settings,
      provider,
      model,
      permissionMode: permissionMode || "schema_only",
      connectionString,
      dbType,
      selectedNamespace: namespace,
      schemaContext,
      dashboardContext: [],
      workingDirectory: getAgentSandboxCwd(),
      emitStep: (message: string) => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "step", message })}\n\n`);
        }
      },
    };

    const { session, dispose } = await createRexaDbPiSession(piInput);

    let fullText = "";
    try {
      fullText = await streamPiResponse({
        session,
        history: [],
        prompt,
        emit: emitSse,
        isAborted: () => aborted,
      });
    } finally {
      dispose();
    }

    if (!aborted) {
      const dashboardPlan = extractDashboardPlan(fullText);
      if (dashboardPlan) {
        res.write(`data: ${JSON.stringify({ type: "result", message: "Dashboard plan generated.", data: dashboardPlan })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: "assistant", message: fullText })}\n\n`);
      }
    }
    res.end();
  } catch (error: any) {
    handleSseError(error, "agent/generate-dashboard/stream", res);
  }
});

function extractDashboardPlan(text: string): { name?: string; widgets?: unknown[]; assistantMessage?: string } | null {
  const match = text.match(/```dashboard\n?([\s\S]*?)```/);
  const jsonStr = match?.[1]?.trim();
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      name: parsed.name || parsed.title,
      widgets: parsed.widgets,
      assistantMessage: text.replace(/```dashboard[\s\S]*?```/, "").trim(),
    };
  } catch {
    return null;
  }
}

app.post("/api/sql/cancel", (req, res) => {
  res.json({ success: true });
});

// Tauri updater placeholder
app.get("/api/updates/check", async (_req, res) => {
  res.json({ success: true, updateAvailable: false });
});

// Studio API proxy — forwards requests to the configured studio backend
// Bun v1.3.14+ ships with path-to-regexp v8+ which rejects wildcard strings;
// use a regex to bypass path-to-regexp entirely
app.all(/^\/api\/studio-proxy(?:\/|$)/, async (req, res) => {
  const studioUrl = (req.headers["x-studio-url"] as string || "").replace(/\/+$/, "");
  log(`[proxy] ${req.method} ${req.path} x-studio-url="${req.headers["x-studio-url"]}"`);
  if (!studioUrl) {
    log(`[proxy] MISSING X-Studio-Url header`);
    res.status(400).json({ error: "Missing X-Studio-Url header" });
    return;
  }

  const targetPath = req.path.replace(/^\/api\/studio-proxy\//, "");
  const cleanPath = targetPath.replace(/^api\//, "");
  const targetUrl = `${studioUrl}/api/${cleanPath}`;
  log(`[proxy] targetUrl="${targetUrl}"`);

  const headers: Record<string, string> = {
    "Content-Type": req.headers["content-type"] as string || "application/json",
  };
  const auth = req.headers["authorization"] as string | undefined;
  if (auth) headers["Authorization"] = auth;

  try {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body);
    log(`[proxy] fetching ${req.method} ${targetUrl + query}`);
    const res_ = await fetch(targetUrl + query, {
      method: req.method,
      headers,
      body,
    });
    const text = await res_.text();
    log(`[proxy] response status=${res_.status} body="${text.slice(0, 200)}"`);
    let json: unknown;
    try { json = JSON.parse(text); } catch {
      log(`[proxy] NON-JSON response from ${studioUrl}`);
      res.status(502).json({
        error: `Workspace server returned non-JSON response (status ${res_.status}). Check that "${studioUrl}" is the correct workspace backend URL.`,
      });
      return;
    }
    res.status(res_.status).json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy request failed";
    log(`[proxy] FETCH ERROR: ${message}`);
    res.status(502).json({
      error: `Cannot reach workspace server at "${studioUrl}". ${message}`,
    });
  }
});

// ─── Workflows ────────────────────────────────────────────────────────────────

function workflowId() {
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function runId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

app.get("/api/workflows", async (req, res) => {
  try {
    const { db, workflows, eq } = await getWorkflowDeps();
    const connectionId = Number(req.query.connectionId);
    if (!connectionId || Number.isNaN(connectionId)) {
      res.json({ success: true, data: [] });
      return;
    }
    const rows = await db.select().from(workflows).where(eq(workflows.connectionId, connectionId));
    res.json({ success: true, data: rows });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/workflows", async (req, res) => {
  try {
    const { db, workflows } = await getWorkflowDeps();
    const now = Date.now();
    const row = {
      id: workflowId(),
      connectionId: req.body.connectionId ? Number(req.body.connectionId) : null,
      name: req.body.name || "Untitled Workflow",
      description: req.body.description || null,
      nodesJson: JSON.stringify(req.body.nodes || []),
      edgesJson: JSON.stringify(req.body.edges || []),
      scheduleEnabled: req.body.scheduleEnabled ? 1 : 0,
      scheduleType: req.body.scheduleType || null,
      scheduleValue: req.body.scheduleValue || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(workflows).values(row as any);
    res.json({ success: true, data: { ...row, nodes: req.body.nodes || [], edges: req.body.edges || [] } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/workflows/:id", async (req, res) => {
  try {
    const { db, workflows, eq } = await getWorkflowDeps();
    const rows = await db.select().from(workflows).where(eq(workflows.id, req.params.id));
    if (!rows.length) { res.json({ success: false, error: "Not found" }); return; }
    res.json({ success: true, data: rows[0] });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.put("/api/workflows/:id", async (req, res) => {
  try {
    const { db, workflows, eq } = await getWorkflowDeps();
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.nodes !== undefined) updates.nodesJson = JSON.stringify(req.body.nodes);
    if (req.body.edges !== undefined) updates.edgesJson = JSON.stringify(req.body.edges);
    if (req.body.scheduleEnabled !== undefined) updates.scheduleEnabled = req.body.scheduleEnabled ? 1 : 0;
    if (req.body.scheduleType !== undefined) updates.scheduleType = req.body.scheduleType;
    if (req.body.scheduleValue !== undefined) updates.scheduleValue = req.body.scheduleValue;
    // fallow-ignore-next-line code-duplication
    await db.update(workflows).set(updates as any).where(eq(workflows.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// fallow-ignore-next-line code-duplication
app.delete("/api/workflows/:id", async (req, res) => {
  try {
    const { db, workflows, eq } = await getWorkflowDeps();
    await db.delete(workflows).where(eq(workflows.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/workflows/:id/run", async (req, res) => {
  try {
    const { db, workflows, workflowRuns, eq } = await getWorkflowDeps();
    const { executeWithMastra } = await import("../lib/workflows/mastra-adapter");

    const rows = await db.select().from(workflows).where(eq(workflows.id, req.params.id));
    if (!rows.length) { res.json({ success: false, error: "Workflow not found" }); return; }
    const wf = rows[0];
    // "Run" tests the editor's current canvas, which may have unsaved edits -
    // use the nodes/edges the client sends if provided, falling back to the
    // persisted version for the scheduler and any other caller that omits them.
    const nodes = req.body?.nodes !== undefined ? req.body.nodes : JSON.parse(wf.nodesJson || "[]");
    const edges = req.body?.edges !== undefined ? req.body.edges : JSON.parse(wf.edgesJson || "[]");
    const trigger = (req.body?.trigger as "manual" | "schedule") || "manual";

    const rid = runId();
    const startedAt = Date.now();
    await db.insert(workflowRuns).values({
      id: rid,
      workflowId: wf.id,
      status: "running",
      startedAt,
      trigger,
    } as any);

    // Stream node-start/node-done as the workflow actually executes them (the
    // runner already awaits each node in graph order before starting the next)
    // so the client can highlight nodes one at a time instead of only learning
    // the outcome after the whole run finishes.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    (res as any).flushHeaders?.();
    const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      const { outputs, error } = await executeWithMastra(
        nodes, edges, trigger, req.body?.initialData, wf.connectionId,
        (event) => send(event),
      );
      const finishedAt = Date.now();
      const status = error ? "error" : "success";
      // fallow-ignore-next-line code-duplication
      await db.update(workflowRuns).set({
        status,
        finishedAt,
        nodesOutputJson: JSON.stringify(outputs),
        error: error || null,
      } as any).where(eq(workflowRuns.id, rid));
      // fallow-ignore-next-line code-duplication
      await db.update(workflows).set({ lastRunAt: finishedAt, updatedAt: finishedAt } as any).where(eq(workflows.id, wf.id));
      send({ type: "run-complete", runId: rid, status, outputs, error });
    } catch (execErr: any) {
      const finishedAt = Date.now();
      await db.update(workflowRuns).set({
        status: "error",
        finishedAt,
        error: execErr.message,
      } as any).where(eq(workflowRuns.id, rid));
      send({ type: "run-complete", runId: rid, status: "error", error: execErr.message });
    }
    res.end();
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/workflows/:id/runs", async (req, res) => {
  try {
    const { db, workflowRuns, eq, desc } = await getWorkflowDeps();
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await db.select().from(workflowRuns)
      .where(eq(workflowRuns.workflowId, req.params.id))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit);
    res.json({ success: true, data: rows });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Cron scheduler — checks every minute for due workflows
(async () => {
  try {
    const { ensureCoreTables } = await import("../lib/db/ensure-core-tables");
    await ensureCoreTables();

    async function runScheduledWorkflows() {
      try {
        const { db } = await import("../lib/db/index");
        const { workflows, workflowRuns } = await import("../lib/db/schema");
        const { eq, and } = await import("drizzle-orm");
        const { executeWithMastra, matchesCron } = await import("../lib/workflows/mastra-adapter");

        const enabled = await db.select().from(workflows).where(eq(workflows.scheduleEnabled as any, 1));
        const now = new Date();

        for (const wf of enabled) {
          try {
            if (!wf.scheduleType || !wf.scheduleValue) continue;

            let shouldRun = false;
            if (wf.scheduleType === "cron") {
              shouldRun = matchesCron(wf.scheduleValue, now);
            } else if (wf.scheduleType === "datetime") {
              const target = new Date(wf.scheduleValue);
              const diff = Math.abs(now.getTime() - target.getTime());
              const lastRun = wf.lastRunAt || 0;
              shouldRun = diff < 60_000 && (Date.now() - lastRun) > 60_000;
            }

            if (!shouldRun) continue;

            const nodes = JSON.parse(wf.nodesJson || "[]");
            const edges = JSON.parse(wf.edgesJson || "[]");
            const rid = runId();
            const startedAt = Date.now();

            await db.insert(workflowRuns).values({ id: rid, workflowId: wf.id, status: "running", startedAt, trigger: "schedule" } as any);
            const { outputs, error } = await executeWithMastra(nodes, edges, "schedule", undefined, wf.connectionId);
            const finishedAt = Date.now();
            // fallow-ignore-next-line code-duplication
            await db.update(workflowRuns).set({ status: error ? "error" : "success", finishedAt, nodesOutputJson: JSON.stringify(outputs), error: error || null } as any).where(eq(workflowRuns.id, rid));
            // fallow-ignore-next-line code-duplication
            await db.update(workflows).set({ lastRunAt: finishedAt, updatedAt: finishedAt } as any).where(eq(workflows.id, wf.id));
            log(`[workflow-scheduler] ran ${wf.name} (${wf.id}) — ${error ? "error" : "success"}`);
          } catch (err: any) {
            log(`[workflow-scheduler] error running ${wf.id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        log(`[workflow-scheduler] tick error: ${err.message}`);
      }
    }

    setInterval(runScheduledWorkflows, 60_000);
    log("[workflow-scheduler] started");
  } catch (e: any) {
    log("[workflow-scheduler] startup error:", e.message);
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Agent Harness Endpoints — cached like t3code's providerStatusCache
// ─────────────────────────────────────────────────────────────────────────────
let providersRefreshPromise: Promise<any> | null = null;

async function refreshProvidersCacheInBackground() {
  if (providersRefreshPromise) return providersRefreshPromise;
  providersRefreshPromise = (async () => {
    try {
      const { detectProviders } = await import("../lib/agents/detect-providers");
      const { listProviderModels } = await import("../lib/agents/list-provider-models");
      const { listProviderModes } = await import("../lib/agents/list-provider-modes");
      const { readServerProviderCache, writeServerProviderCache } = await import(
        "../lib/agents/provider-cache-server"
      );
      const { mergeCachedProviders } = await import("../lib/agents/provider-cache");
      const previous = readServerProviderCache();
      const providers = await detectProviders();
      const providersWithModels = await Promise.all(
        providers.map(async (p) => {
          const [models, modes] = await Promise.all([
            listProviderModels(p.id, p.binaryPath),
            listProviderModes(p.id, p.binaryPath),
          ]);
          return { ...p, models, modes };
        }),
      );
      const merged = mergeCachedProviders(providersWithModels, previous?.providers ?? null);
      writeServerProviderCache(merged);
      return merged;
    } catch (err: any) {
      log("[agents/detect] background refresh error:", err.message);
      return null;
    } finally {
      providersRefreshPromise = null;
    }
  })();
  return providersRefreshPromise;
}

app.get("/api/agents/detect", async (_req, res) => {
  try {
    const { readServerProviderCache, writeServerProviderCache } = await import(
      "../lib/agents/provider-cache-server"
    );
    const cached = readServerProviderCache();
    const now = Date.now();
    const freshMs = 30_000; // 30s fresh, like t3's quick revalidate
    const staleMs = 5 * 60_000; // 5 min stale-while-revalidate
    const isFresh = cached && now - cached.cachedAt < freshMs;
    const isStaleUsable = cached && now - cached.cachedAt < staleMs;

    // Instant path: serve from disk cache (hydrated) — mirrors t3's hydrateCachedProvider
    if (isFresh && cached) {
      res.json({ providers: cached.providers, cached: true });
      return;
    }
    if (isStaleUsable && cached) {
      res.json({ providers: cached.providers, cached: true, stale: true });
      // Revalidate in background without blocking
      void refreshProvidersCacheInBackground();
      return;
    }

    // No usable cache — try to serve stale anyway while we probe, else probe blocking
    if (cached && cached.providers.length > 0) {
      res.json({ providers: cached.providers, cached: true, stale: true });
      void refreshProvidersCacheInBackground();
      return;
    }

    // Cold start: no cache file yet — probe and populate (first run still ~2-3s, then instant)
    const fresh = await refreshProvidersCacheInBackground();
    if (fresh && fresh.length > 0) {
      res.json({ providers: fresh });
      return;
    }
    // Fallback to live probe if background failed
    const { detectProviders } = await import("../lib/agents/detect-providers");
    const { listProviderModels } = await import("../lib/agents/list-provider-models");
    const { listProviderModes } = await import("../lib/agents/list-provider-modes");
    const providers = await detectProviders();
    const providersWithModels = await Promise.all(
      providers.map(async (p) => {
        const [models, modes] = await Promise.all([
          listProviderModels(p.id, p.binaryPath),
          listProviderModes(p.id, p.binaryPath),
        ]);
        return { ...p, models, modes };
      }),
    );
    try {
      writeServerProviderCache(providersWithModels);
    } catch {}
    res.json({ providers: providersWithModels });
  } catch (err: any) {
    log("[agents/detect] error:", err.message);
    // Last resort: try to return stale cache even on error
    try {
      const { readServerProviderCache } = await import("../lib/agents/provider-cache-server");
      const cached = readServerProviderCache();
      if (cached) {
        res.json({ providers: cached.providers, cached: true, stale: true, error: err.message });
        return;
      }
    } catch {}
    res.json({ providers: [], error: err.message });
  }
});

app.get("/api/agents/models/:providerId", async (req, res) => {
  try {
    const providerId = req.params.providerId as any;
    // Instant path via server cache (like t3's ProviderRegistry.getProviders)
    try {
      const { readServerProviderCache } = await import("../lib/agents/provider-cache-server");
      const cached = readServerProviderCache();
      const hit = cached?.providers.find((p) => p.id === providerId);
      if (hit?.models && hit.models.length > 0) {
        res.json({ models: hit.models, cached: true });
        return;
      }
    } catch {}
    const { detectProviders } = await import("../lib/agents/detect-providers");
    const { listProviderModels } = await import("../lib/agents/list-provider-models");
    const providers = await detectProviders();
    const provider = providers.find((p) => p.id === providerId);
    const models = await listProviderModels(providerId, provider?.binaryPath);
    res.json({ models });
  } catch (err: any) {
    log("[agents/models] error:", err.message);
    res.json({ models: [], error: err.message });
  }
});

app.post("/api/agents/chat/stream", async (req, res) => {
  try {
    const {
      provider,
      prompt,
      history,
      connectionId,
      connectionString,
      connectionName,
      dbType,
      schemaContext,
      mode,
      appMode,
    } = req.body;

    if (!provider || !prompt) {
      res.status(400).json({ error: "provider and prompt are required" });
      return;
    }

    const { REXADB_PLAN_MODE, REXADB_BUILD_MODE } = await import(
      "../lib/agents/app-modes"
    );
    const resolvedAppMode =
      appMode && typeof appMode === "object" && typeof appMode.id === "string"
        ? {
            id: String(appMode.id),
            label: String(appMode.label || appMode.id),
            kind:
              appMode.kind === "build" || appMode.kind === "custom"
                ? appMode.kind
                : ("plan" as const),
            allowSqlRead: appMode.allowSqlRead !== false,
            allowSqlWrite: appMode.allowSqlWrite === true,
            promptRules: String(appMode.promptRules || ""),
            mapsToProviderMode: appMode.mapsToProviderMode,
          }
        : appMode?.id === "rexadb-build"
          ? REXADB_BUILD_MODE
          : REXADB_PLAN_MODE;

    // Prefer a per-connection sandbox so schemas never bleed across DBs.
    const agentCwd = getAgentSandboxCwd(connectionId);
    const { materializeAgentSandbox, AGENT_SCHEMA_FILENAME } = await import(
      "../lib/agents/sandbox-cwd"
    );

    // Resolve schema: trust the client when present, otherwise fetch live from the DB.
    let schemaTables = Array.isArray(schemaContext) ? schemaContext : [];
    if (
      schemaTables.length === 0 &&
      typeof connectionString === "string" &&
      connectionString &&
      dbType !== "redis"
    ) {
      try {
        const result = await mod.fetchAllTablesWithColumns(connectionString, {});
        if (result?.success && Array.isArray(result.data)) {
          const grouped = new Map<
            string,
            { schema: string; table: string; columns: Array<{ name: string; type: string }> }
          >();
          for (const row of result.data) {
            const schema = String(row?.table_schema || row?.schema || "").trim();
            const table = String(row?.table_name || row?.name || "").trim();
            if (!schema || !table) continue;
            const key = `${schema}.${table}`;
            const existing = grouped.get(key) || { schema, table, columns: [] };
            const columnName = String(row?.column_name || "").trim();
            if (columnName) {
              existing.columns.push({
                name: columnName,
                type: String(row?.data_type || "text"),
              });
            }
            grouped.set(key, existing);
          }
          schemaTables = Array.from(grouped.values());
          log(
            `[agents/chat/stream] loaded ${schemaTables.length} tables server-side for connection`,
            connectionId ?? connectionName ?? "",
          );
        }
      } catch (err: any) {
        log("[agents/chat/stream] server-side schema fetch failed:", err?.message);
      }
    }

    materializeAgentSandbox(agentCwd, {
      dbType: String(dbType || "unknown"),
      connectionName:
        typeof connectionName === "string" && connectionName
          ? connectionName
          : undefined,
      connectionId:
        connectionId !== undefined && connectionId !== null
          ? connectionId
          : undefined,
      schemaContext: schemaTables,
    });
    if (schemaTables.length === 0) {
      log(
        "[agents/chat/stream] warning: schemaContext empty — agent may not see tables",
      );
    }

    if (provider === "rexadb") {
      // Route to existing built-in agent — pick the first configured provider
      // (like t3's resolveModelScope) instead of hardcoding ollama/llama3.
      const settingsResult = await mod.getGlobalAiSettings();
      if (!settingsResult.success) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify({ type: "error", content: "Failed to load AI settings: " + (settingsResult.error || "unknown") })}\n\n`);
        res.end();
        return;
      }
      const allSettings = settingsResult.data as any;
      const providerPriority: string[] = ["openai", "anthropic", "google", "openrouter", "kilo", "ollama", "external"];
      let picked: { provider: string; model: string } | null = null;
      for (const p of providerPriority) {
        const cfg = allSettings.providers?.[p];
        if (!cfg || cfg.enabled === false) continue;
        if (p !== "ollama" && !cfg.apiKey?.trim()) continue;
        // Prefer the first model in the list (often the free one for kilo) over defaultModel
        const modelId = (cfg.models?.[0] || cfg.defaultModel || cfg.model || "").trim() || (p === "ollama" ? "llama3" : "");
        if (modelId) {
          picked = { provider: p, model: modelId };
          break;
        }
      }
      // Fallback to any provider with a key, else ollama
      if (!picked) {
        for (const [p, cfg] of Object.entries(allSettings.providers || {})) {
          const c = cfg as any;
          if (c?.enabled === false) continue;
          if (c?.apiKey?.trim() && (c.models?.[0] || c.defaultModel || c.model)) {
            picked = { provider: p, model: (c.models?.[0] || c.defaultModel || c.model).trim() };
            break;
          }
        }
      }
      if (!picked) {
        // No provider configured — surface a clear error instead of empty response
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify({ type: "error", content: "No AI provider is configured. Please add an API key in Settings → AI (OpenAI, Anthropic, etc.) and try again." })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        return;
      }

      const resolved = await resolveAiReq(
        {
          body: {
            provider: picked.provider,
            model: picked.model,
            prompt,
            connectionString,
            dbType,
            schemaContext: schemaTables,
          },
        } as any,
        res,
      );
      if (!resolved) return;

      // Use a mutable aborted flag so emitStep / isAborted see live value
      const abortState = { aborted: false };
      req.on("close", () => { abortState.aborted = true; });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const permissionMode = resolvedAppMode.allowSqlWrite
        ? "schema_with_data"
        : resolvedAppMode.allowSqlRead
          ? "schema_with_data"
          : "schema_only";
      const modePrefixedPrompt = resolvedAppMode.promptRules
        ? `${resolvedAppMode.promptRules}\n\nUser request:\n${prompt}`
        : prompt;

      // Translate Pi's assistant_delta → harness text_delta so use-agent-harness renders it
      const piToHarnessEmit = (event: any) => {
        if (abortState.aborted) return;
        if (event.type === "assistant_delta" && event.message) {
          res.write(`data: ${JSON.stringify({ type: "text_delta", content: event.message })}\n\n`);
        } else if (event.type === "step" && event.message) {
          res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "step", input: { message: event.message }, label: event.message })}\n\n`);
        } else if (event.type === "tool_start") {
          let input: any = {};
          try { input = event.command ? JSON.parse(event.command) : {}; } catch {}
          res.write(`data: ${JSON.stringify({ type: "tool_start", tool: event.tool || "tool", input, label: event.tool || "tool", command: event.command })}\n\n`);
        } else if (event.type === "tool_output") {
          res.write(`data: ${JSON.stringify({ type: "tool_output", output: event.output || "", isError: !!event.isError })}\n\n`);
        } else if (event.type === "tool_end") {
          // no-op, harness will complete on tool_output
        } else if (event.type === "assistant_done" || event.type === "done") {
          // handled after streamPiResponse
        }
      };

      const piInput: PiAgentInput = {
        settings: resolved.settings,
        provider: resolved.provider,
        model: resolved.model,
        permissionMode,
        connectionString: resolved.connectionString,
        dbType: resolved.dbType,
        selectedNamespace: resolved.namespace,
        schemaContext: schemaTables.length > 0 ? schemaTables : resolved.schemaContext,
        dashboardContext: [],
        workflowContext: { existing: [], current: null },
        workingDirectory: agentCwd,
        emitStep: (message: string) => {
          if (!abortState.aborted) {
            res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "step", input: { message }, label: message })}\n\n`);
          }
        },
      };

      const { session, dispose } = await createRexaDbPiSession(piInput);
      try {
        const fullText = await streamPiResponse({
          session,
          history: history || [],
          prompt: modePrefixedPrompt,
          emit: piToHarnessEmit,
          isAborted: () => abortState.aborted,
        });
        if (!abortState.aborted) {
          if (!fullText.trim()) {
            res.write(`data: ${JSON.stringify({ type: "error", content: "The assistant returned an empty response. Please try rephrasing your request or check that your AI provider is configured correctly." })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          } else {
            // fullText already streamed via text_delta, just signal completion
            res.write(`data: ${JSON.stringify({ type: "done", content: fullText })}\n\n`);
          }
        }
      } catch (err: any) {
        if (!abortState.aborted) {
          const msg = err?.message || String(err);
          // Surface Pi errors (including "model not found", empty, etc.) as harness errors
          res.write(`data: ${JSON.stringify({ type: "error", content: msg })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        }
      } finally {
        dispose();
      }
      res.end();
      return;
    }

    // External CLI harness
    const { getHarnessClient, spawnHarness } = await import("../lib/agents/harness-clients");
    const { buildAgentDatabaseContext } = await import("../lib/ai/system-prompt");
    const { buildRexaMcpServerConfig } = await import("../lib/agents/mcp/config");
    const client = getHarnessClient(provider);

    const mcp =
      typeof connectionString === "string" && connectionString
        ? buildRexaMcpServerConfig({
            connectionString,
            dbType: String(dbType || "unknown"),
            connectionName:
              typeof connectionName === "string" ? connectionName : undefined,
            appMode: resolvedAppMode,
          })
        : undefined;

    // Prefer app-mode → provider CLI mapping when the client didn't send a mode.
    const providerMode =
      (typeof mode === "string" && mode) ||
      resolvedAppMode.mapsToProviderMode?.[provider as keyof typeof resolvedAppMode.mapsToProviderMode] ||
      undefined;

    // Inject live connection + schema + app-mode rules into the prompt AND SCHEMA.md.
    const dbContext = buildAgentDatabaseContext({
      dbType: String(dbType || "unknown"),
      connectionName:
        typeof connectionName === "string" && connectionName
          ? connectionName
          : undefined,
      connectionId:
        connectionId !== undefined && connectionId !== null
          ? connectionId
          : undefined,
      selectedNamespace: undefined,
      schemaContext: schemaTables,
      // Absolute path — a bare filename left the model guessing (it tried
      // "/SCHEMA.md" at filesystem root and got "File not found").
      schemaFilePath: path.join(agentCwd, AGENT_SCHEMA_FILENAME),
    });
    const modeRules = resolvedAppMode.promptRules
      ? `\n\nAgent mode (${resolvedAppMode.label}):\n${resolvedAppMode.promptRules}`
      : "";
    const harnessPrompt = `${dbContext}${modeRules}\n\nUser request:\n${prompt}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let aborted = false;
    let finished = false;
    let childProcess: any = null;
    const finish = () => {
      if (!finished) {
        finished = true;
        try { res.end(); } catch {}
      }
    };
    req.on("close", () => {
      aborted = true;
      try { childProcess?.kill("SIGTERM"); } catch {}
    });

    // Interactive harnesses (Cursor / Grok via ACP JSON-RPC over stdio)
    if (typeof (client as any).runPrompt === "function") {
      try {
        await (client as any).runPrompt({
          prompt: harnessPrompt,
          cwd: agentCwd,
          history,
          mode: providerMode,
          mcp,
          onEvent: (event: any) => {
            if (aborted || finished) return;
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            if (event.type === "done") finish();
          },
          onSpawn: (proc: any) => {
            req.on("close", () => {
              try { proc.kill("SIGTERM"); } catch {}
            });
          },
        });
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        }
      } catch (err: any) {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
        }
      } finally {
        finish();
      }
      return;
    }

    childProcess = spawnHarness(provider, {
      prompt: harnessPrompt,
      cwd: agentCwd,
      history,
      mode: providerMode,
      mcp,
    }).process;

    let buffer = "";

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      if (aborted || finished) return;
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const events = client.parseLineAll
          ? client.parseLineAll(line)
          : (() => {
              const e = client.parseLine(line);
              return e ? [e] : [];
            })();
        for (const event of events) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === "done") {
            finish();
            return;
          }
        }
      }
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      if (aborted) return;
      const text = chunk.toString().trim();
      if (text) {
        log(`[agents/${provider}] stderr:`, text.slice(0, 200));
      }
    });

    childProcess.on("close", (code: number | null) => {
      if (aborted) return;
      // Flush remaining buffer
      if (buffer.trim()) {
        const events = client.parseLineAll
          ? client.parseLineAll(buffer)
          : (() => {
              const e = client.parseLine(buffer);
              return e ? [e] : [];
            })();
        for (const event of events) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === "done") {
            finish();
            return;
          }
        }
      }
      if (!aborted) {
        if (code !== 0) {
          res.write(
            `data: ${JSON.stringify({ type: "error", content: `Agent exited with code ${code}` })}\n\n`,
          );
        }
        res.write(`data: ${JSON.stringify({ type: "done", exitCode: code })}\n\n`);
        finish();
      }
    });

    childProcess.on("error", (err: Error) => {
      if (aborted || finished) return;
      log(`[agents/${provider}] spawn error:`, err.message);
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
      finish();
    });
  } catch (err: any) {
    log("[agents/chat/stream] error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
      res.end();
    }
  }
});

function startServer(port: number, maxPort: number = 3900) {
  const server = app.listen(port, "127.0.0.1", () => {
    log(`[rexadb-server] listening on port ${port}`);
    logToFile(`listening on port ${port}`);
    // Warm provider cache in background so first /api/agents/detect is instant (t3 pattern)
    setTimeout(() => {
      void refreshProvidersCacheInBackground().catch(() => {});
    }, 500);
    // Write port file for frontend discovery
    const dataDir = process.env.REXADB_USER_DATA_DIR || "/tmp";
    try {
      fs.writeFileSync(path.join(dataDir, "port.json"), JSON.stringify({ port }));
    } catch {}
    // Signal readiness to parent process
    if (process.send) {
      process.send({ type: "ready", port });
    }
  });
  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE" && port < maxPort) {
      const nextPort = port + 1;
      log(`[rexadb-server] port ${port} in use, trying ${nextPort}`);
      logToFile(`port ${port} in use, trying ${nextPort}`);
      startServer(nextPort, maxPort);
    } else {
      log(`[rexadb-server] failed to start on port ${port}: ${err.message}`);
      logToFile(`failed to start on port ${port}: ${err.message}`);
      process.exit(1);
    }
  });
}
startServer(PORT);
