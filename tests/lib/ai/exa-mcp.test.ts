import test from "node:test";
import assert from "node:assert/strict";

import {
  ExaMcpError,
  fetchWebFree,
  parseFreeSearchText,
  searchWebFree,
} from "../../../lib/ai/exa-mcp";

const SEARCH_TEXT = [
  "Title: RexaDB",
  "URL: https://github.com/rexadbapp",
  "Published: N/A",
  "Highlights:",
  "RexaDB provides database management tools",
  "---",
  "Title: Other",
  "URL: https://example.com/other",
  "Body text here",
].join("\n");

function sseResult(result: unknown, sessionId = "sess-1"): Response {
  return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "mcp-session-id": sessionId },
  });
}

/** Minimal MCP server stub: initialize → 202 for notifications → tools/call. */
function mockMcp(callText: string, onCall?: (body: any) => void): typeof fetch {
  return (async (url: any, init: any) => {
    assert.equal(String(url), "https://mcp.exa.ai/mcp");
    const body = JSON.parse(String(init.body));
    if (body.method === "initialize") {
      return sseResult({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "x" } });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (body.method === "tools/call") {
      onCall?.(body);
      return sseResult({ content: [{ type: "text", text: callText }] });
    }
    throw new Error(`unexpected method ${body.method}`);
  }) as typeof fetch;
}

test("free search returns parsed results", async () => {
  let seenArgs: any = null;
  const results = await searchWebFree("RexaDB", {
    numResults: 3,
    fetchImpl: mockMcp(SEARCH_TEXT, (body) => {
      seenArgs = body.params.arguments;
    }),
  });
  assert.equal(seenArgs.name, undefined); // name is on params, not arguments
  assert.equal(results.length, 2);
  assert.equal(results[0].url, "https://github.com/rexadbapp");
  assert.equal(results[0].title, "RexaDB");
  assert.match(results[0].text || "", /database management tools/);
});

test("free search sends query, objective, numResults", async () => {
  let seen: any = null;
  await searchWebFree("hello", {
    fetchImpl: mockMcp("Title: H\nURL: https://h.com\nx", (body) => {
      seen = body.params;
    }),
  });
  assert.equal(seen.name, "web_search_exa");
  assert.equal(seen.arguments.query, "hello");
  assert.ok(String(seen.arguments.objective).length > 0);
  assert.equal(seen.arguments.numResults, 5);
});

test("empty query rejected before network", async () => {
  let called = false;
  const fetchImpl: typeof fetch = (async () => {
    called = true;
    throw new Error("unreachable");
  }) as unknown as typeof fetch;
  const err = await searchWebFree("  ", { fetchImpl }).catch((e) => e);
  assert.ok(err instanceof ExaMcpError);
  assert.equal(err.code, "bad-request");
  assert.equal(called, false);
});

test("rate limit maps to rate-limited", async () => {
  const fetchImpl: typeof fetch = (async () =>
    new Response("slow", { status: 429 })) as unknown as typeof fetch;
  const err = await searchWebFree("x", { fetchImpl }).catch((e) => e);
  assert.ok(err instanceof ExaMcpError);
  assert.equal(err.code, "rate-limited");
  assert.match(err.message, /Settings → AI → Web search/);
});

test("tool error envelope maps to exhausted on quota words", async () => {
  const fetchImpl = (async (url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    if (body.method === "initialize") return sseResult({ protocolVersion: "1", capabilities: {}, serverInfo: {} });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 3, error: { code: -32000, message: "daily quota exceeded" } })}\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;
  const err = await searchWebFree("x", { fetchImpl }).catch((e) => e);
  assert.ok(err instanceof ExaMcpError);
  assert.equal(err.code, "exhausted");
});

test("network failure maps to network-error", async () => {
  const fetchImpl: typeof fetch = (async () => {
    throw new Error("dns fail");
  }) as unknown as typeof fetch;
  const err = await searchWebFree("x", { fetchImpl }).catch((e) => e);
  assert.ok(err instanceof ExaMcpError);
  assert.equal(err.code, "network-error");
});

test("fetchWebFree requires urls, caps at 5, falls back to raw text", async () => {
  const empty = await fetchWebFree([], {
    fetchImpl: mockMcp("x"),
  }).catch((e) => e);
  assert.ok(empty instanceof ExaMcpError);
  assert.equal(empty.code, "bad-request");

  let seenUrls: string[] = [];
  const pages = await fetchWebFree(["https://a.com", "https://b.com", "https://c.com", "https://d.com", "https://e.com", "https://f.com"], {
    fetchImpl: mockMcp("no blocks here", (body) => {
      seenUrls = body.params.arguments.urls;
    }),
  });
  assert.deepEqual(seenUrls, ["https://a.com", "https://b.com", "https://c.com", "https://d.com", "https://e.com"]);
  assert.equal(pages.length, 5);
  assert.equal(pages[0].url, "https://a.com");
});

test("parseFreeSearchText skips blocks without URL", () => {
  assert.deepEqual(parseFreeSearchText(""), []);
  assert.deepEqual(parseFreeSearchText("Title: No URL here\nsome text"), []);
});
