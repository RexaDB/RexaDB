/**
 * Streamable-HTTP transport for the external MCP server.
 *
 * Mounted by the sidecar (`server/index.ts`) at `/mcp`. Stateful sessions:
 * each client `initialize` mints a server-side session (own transport +
 * server instance) keyed by `mcp-session-id`, so any number of harnesses can
 * stay connected at once. Auth is a Bearer token managed in Settings →
 * MCP Server. Tool handlers resolve config + mode lazily per call, so no
 * restart is needed after Settings changes.
 *
 * (A single shared transport does NOT work here — the SDK ties server
 * initialization to one transport instance, and sharing one rejects every
 * client after the first with "Server already initialized".)
 */
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createExternalMcpServer } from "./handlers";

type McpSession = {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
};

const sessions = new Map<string, McpSession>();
/** Drop sessions idle this long when a new one arrives (dead clients). */
const SESSION_IDLE_MS = 30 * 60 * 1000;

function sweepIdleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastSeen > SESSION_IDLE_MS) {
      sessions.delete(id);
      session.transport.close().catch(() => {});
    }
  }
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (m) => m && typeof m === "object" && (m as { method?: unknown }).method === "initialize",
  );
}

function jsonRpcError(res: any, status: number, message: string) {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

/** Express-compatible handler for GET/POST/DELETE /mcp. */
export async function handleMcpHttpRequest(req: any, res: any) {
  const sessionId = String(req.headers?.["mcp-session-id"] || "");

  try {
    if (req.method === "POST") {
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
        existing.lastSeen = Date.now();
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }
      // No session yet — only an initialize request may open one.
      if (!isInitializeRequest(req.body)) {
        jsonRpcError(res, 400, "No valid MCP session. Send an initialize request first.");
        return;
      }
      sweepIdleSessions();
      const server = createExternalMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, lastSeen: Date.now() });
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      // Fallback: if the SDK didn't fire onsessioninitialized, index by getter.
      const id = transport.sessionId;
      if (id && !sessions.has(id)) sessions.set(id, { transport, lastSeen: Date.now() });
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (!existing) {
        jsonRpcError(res, 400, "No valid MCP session for this request.");
        return;
      }
      existing.lastSeen = Date.now();
      await existing.transport.handleRequest(req, res);
      if (req.method === "DELETE") sessions.delete(sessionId);
      return;
    }

    jsonRpcError(res, 405, "Method not allowed. Use GET, POST or DELETE.");
  } catch (error: any) {
    console.error("[rexadb-mcp] http error:", error?.message || error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP error" },
        id: null,
      });
    }
  }
}

export function isMcpBearerAuthorized(req: any, expectedToken: string): boolean {
  if (!expectedToken) return false;
  const header = String(req.headers?.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(7).trim();
  if (!token || token.length !== expectedToken.length) return false;
  // Constant-time-ish comparison to avoid trivial timing leaks on localhost.
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  return diff === 0;
}
