import test from "node:test";
import assert from "node:assert/strict";

import {
  ExaSearchError,
  fetchExaContents,
  resolveExaApiKey,
  searchExa,
} from "../../../lib/ai/exa-search";

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return (async (url: any, init: any) => handler(String(url), init)) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("missing key reports a setup hint", async () => {
  const err = await searchExa("hello", { apiKey: "", fetchImpl: mockFetch(async () => jsonResponse({})) }).catch((e) => e);
  assert.ok(err instanceof ExaSearchError);
  assert.equal(err.code, "missing-api-key");
  assert.match(err.message, /Settings → AI → Web search/);
  assert.match(err.message, /dashboard\.exa\.ai/);
});

test("empty query is rejected before the network", async () => {
  let called = false;
  const err = await searchExa("  ", {
    apiKey: "k",
    fetchImpl: mockFetch(async () => {
      called = true;
      return jsonResponse({});
    }),
  }).catch((e) => e);
  assert.ok(err instanceof ExaSearchError);
  assert.equal(err.code, "bad-request");
  assert.equal(called, false);
});

test("search posts to /search and maps results", async () => {
  let seenUrl = "";
  let seenInit: RequestInit = {};
  const res = await searchExa("postgres 17", {
    apiKey: "test-key",
    numResults: 3,
    fetchImpl: mockFetch(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({
        results: [
          { title: "T", url: "https://example.com/a", publishedDate: "2024-01-01", text: "body", highlights: ["h"] },
          { title: null, url: "https://example.com/b" },
        ],
        costDollars: { total: 0.007 },
      });
    }),
  });
  assert.equal(seenUrl, "https://api.exa.ai/search");
  assert.equal((seenInit.headers as Record<string, string>)["x-api-key"], "test-key");
  const body = JSON.parse(String(seenInit.body));
  assert.equal(body.query, "postgres 17");
  assert.equal(body.numResults, 3);
  assert.equal(body.contents.text.maxCharacters, 3000);
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].url, "https://example.com/a");
  assert.deepEqual(res.results[0].highlights, ["h"]);
  assert.deepEqual(res.results[1].highlights, []);
  assert.equal(res.costDollars, 0.007);
});

test("numResults is clamped to 1–10", async () => {
  let seenBody: any = null;
  await searchExa("x", {
    apiKey: "k",
    numResults: 99,
    fetchImpl: mockFetch(async (url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse({ results: [] });
    }),
  });
  assert.equal(seenBody.numResults, 10);
});

test("API errors map to codes", async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { error: "Invalid API key", tag: "INVALID_API_KEY" }, "invalid-api-key"],
    [402, { error: "No credits", tag: "NO_MORE_CREDITS" }, "out-of-credits"],
    [429, { error: "Slow down", tag: "RATE_LIMIT_EXCEEDED" }, "rate-limited"],
    [500, {}, "server-error"],
    [400, { error: "Bad query", tag: "INVALID_REQUEST" }, "bad-request"],
  ];
  for (const [status, body, code] of cases) {
    const err = await searchExa("x", {
      apiKey: "k",
      fetchImpl: mockFetch(async () => jsonResponse(body, status)),
    }).catch((e) => e);
    assert.ok(err instanceof ExaSearchError, `status ${status}`);
    assert.equal(err.code, code, `status ${status}`);
  }
});

test("network failure maps to network-error", async () => {
  const err = await searchExa("x", {
    apiKey: "k",
    fetchImpl: mockFetch(async () => {
      throw new Error("boom");
    }),
  }).catch((e) => e);
  assert.ok(err instanceof ExaSearchError);
  assert.equal(err.code, "network-error");
});

test("fetchExaContents requires urls and caps at 5", async () => {
  const empty = await fetchExaContents([], { apiKey: "k" }).catch((e) => e);
  assert.ok(empty instanceof ExaSearchError);
  assert.equal(empty.code, "bad-request");

  let seenBody: any = null;
  const pages = await fetchExaContents(
    ["https://a.com", "https://b.com", "https://c.com", "https://d.com", "https://e.com", "https://f.com", "https://a.com "],
    {
      apiKey: "k",
      fetchImpl: mockFetch(async (url, init) => {
        assert.equal(url, "https://api.exa.ai/contents");
        seenBody = JSON.parse(String(init.body));
        return jsonResponse({ results: [{ title: "A", url: "https://a.com", text: "words" }] });
      }),
    },
  );
  assert.deepEqual(seenBody.urls, ["https://a.com", "https://b.com", "https://c.com", "https://d.com", "https://e.com"]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].text, "words");
});

test("resolveExaApiKey prefers explicit, falls back to env", () => {
  assert.equal(resolveExaApiKey("  abc "), "abc");
  const prev = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "env-key";
  try {
    assert.equal(resolveExaApiKey(null), "env-key");
    assert.equal(resolveExaApiKey("direct"), "direct");
  } finally {
    if (prev === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = prev;
  }
  assert.equal(resolveExaApiKey(""), null);
});
