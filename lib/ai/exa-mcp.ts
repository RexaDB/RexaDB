/**
 * Keyless web search via Exa's public MCP endpoint (no API key needed).
 *
 * Exa lets anyone call their MCP server unauthenticated (roughly 150
 * calls/day). This module speaks the MCP "Streamable HTTP" protocol with
 * plain fetch — no MCP SDK dependency: initialize → tools/call.
 *
 * Used as the default web-search backend when no Exa API key is configured.
 * With a key, lib/ai/exa-search.ts (direct REST API) is preferred.
 */

export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
export const EXA_MCP_FREE_LIMIT_NOTE =
  "The built-in free search allows roughly 150 lookups per day.";

export type ExaFetch = typeof fetch;

export type FreeWebResult = {
  title: string | null;
  url: string;
  text: string | null;
};

export class ExaMcpError extends Error {
  readonly code: "rate-limited" | "exhausted" | "server-error" | "network-error" | "bad-request";
  constructor(
    code: ExaMcpError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ExaMcpError";
    this.code = code;
  }
}

function parseSseDataPayload(body: string): any {
  // Responses arrive as SSE ("event: message\ndata: {...}") but tolerate JSON.
  const dataLines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]");
  const payload = dataLines.length > 0 ? dataLines.join("\n") : body.trim();
  return JSON.parse(payload);
}

async function mcpPost(
  body: Record<string, unknown>,
  sessionId: string | null,
  fetchImpl: ExaFetch,
  id: number,
): Promise<{ data: any; sessionId: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(EXA_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, ...body }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ExaMcpError(
      "network-error",
      `Free web search is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const nextSession =
    res.headers?.get?.("mcp-session-id")?.trim() || sessionId;
  if (res.status === 202) return { data: null, sessionId: nextSession };
  if (!res.ok) {
    if (res.status === 429) {
      throw new ExaMcpError(
        "rate-limited",
        `Free web search is rate-limited right now. ${EXA_MCP_FREE_LIMIT_NOTE} Add an Exa key in Settings → AI → Web search for unlimited use.`,
      );
    }
    if (res.status >= 500) throw new ExaMcpError("server-error", `Free web search is having issues (HTTP ${res.status}). Retry shortly.`);
    throw new ExaMcpError("server-error", `Free web search failed (HTTP ${res.status}).`);
  }
  const text = await res.text();
  if (!text.trim()) return { data: null, sessionId: nextSession };
  return { data: parseSseDataPayload(text), sessionId: nextSession };
}

function extractText(data: any): string {
  const content = data?.result?.content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
      .map((part: any) => part.text as string)
      .join("\n\n");
  }
  if (typeof data?.result?.content === "string") return data.result.content;
  const error = data?.error;
  if (error) {
    const message = String(error?.message || "search failed");
    if (/limit|quota|credit|budget/i.test(message)) {
      throw new ExaMcpError(
        "exhausted",
        `Today's free web searches are used up. ${EXA_MCP_FREE_LIMIT_NOTE} Add an Exa key in Settings → AI → Web search for unlimited use.`,
      );
    }
    throw new ExaMcpError("server-error", `Free web search failed: ${message}`);
  }
  return "";
}

/** Split Exa's "Title:/URL:" blocks into structured results. */
export function parseFreeSearchText(text: string): FreeWebResult[] {
  const results: FreeWebResult[] = [];
  const blocks = String(text || "").split(/\n---\n/);
  for (const block of blocks) {
    const urlMatch = block.match(/^URL:\s*(\S+)/m);
    if (!urlMatch) continue;
    const titleMatch = block.match(/^Title:\s*(.+)$/m);
    results.push({
      title: titleMatch ? titleMatch[1].trim() || null : null,
      url: urlMatch[1].trim(),
      text: block.trim(),
    });
  }
  return results;
}

export type FreeSearchOptions = {
  numResults?: number;
  fetchImpl?: ExaFetch;
};

async function withSession<T>(
  run: (sessionId: string | null, nextId: () => number) => Promise<T>,
  fetchImpl: ExaFetch,
): Promise<T> {
  // Fresh session per call: one extra round-trip, zero stale-session bugs.
  let id = 0;
  const nextId = () => ++id;
  const init = await mcpPost(
    {
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "rexadb", version: "1.0" },
      },
    },
    null,
    fetchImpl,
    nextId(),
  );
  const sessionId = init.sessionId;
  try {
    await mcpPost({ method: "notifications/initialized", params: {} }, sessionId, fetchImpl, nextId());
  } catch {
    // Fire-and-forget per protocol — ignore failures.
  }
  return run(sessionId, nextId);
}

/** Keyless web search. Throws ExaMcpError on failure. */
export async function searchWebFree(
  query: string,
  options: FreeSearchOptions = {},
): Promise<FreeWebResult[]> {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new ExaMcpError("bad-request", "Search query is required.");
  const numResults = Math.min(Math.max(Math.floor(options.numResults ?? 5) || 5, 1), 10);
  const fetchImpl = options.fetchImpl ?? fetch;

  const text = await withSession(async (sessionId, nextId) => {
    const { data } = await mcpPost(
      {
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query: trimmed,
            objective: `Find the most relevant pages for: ${trimmed}`,
            numResults,
          },
        },
      },
      sessionId,
      fetchImpl,
      nextId(),
    );
    return extractText(data);
  }, fetchImpl);

  return parseFreeSearchText(text);
}

/** Keyless page fetch. Throws ExaMcpError on failure. */
export async function fetchWebFree(
  urls: string[],
  options: { fetchImpl?: ExaFetch } = {},
): Promise<FreeWebResult[]> {
  const clean = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || "").trim()).filter(Boolean))].slice(0, 5);
  if (clean.length === 0) throw new ExaMcpError("bad-request", "At least one URL is required.");
  const fetchImpl = options.fetchImpl ?? fetch;

  const text = await withSession(async (sessionId, nextId) => {
    const { data } = await mcpPost(
      {
        method: "tools/call",
        params: { name: "web_fetch_exa", arguments: { urls: clean } },
      },
      sessionId,
      fetchImpl,
      nextId(),
    );
    return extractText(data);
  }, fetchImpl);

  const parsed = parseFreeSearchText(text);
  if (parsed.length > 0) return parsed;
  return clean.map((url) => ({ title: null, url, text: text || null }));
}
