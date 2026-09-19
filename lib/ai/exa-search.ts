/**
 * Minimal Exa web-search client for the AI agent (no extra npm dependency —
 * plain fetch against https://api.exa.ai).
 *
 * Free tier: new accounts get $20 in signup credits and $10 in free credits
 * every month — enough for everyday agent lookups. Key from
 * https://dashboard.exa.ai/api-keys, stored in Settings → AI → Web search
 * (Exa) or via the EXA_API_KEY env var.
 */

export const EXA_API_BASE = "https://api.exa.ai";
export const EXA_DASHBOARD_URL = "https://dashboard.exa.ai/api-keys";
export const EXA_FREE_TIER_NOTE =
  "Exa is free to start ($20 signup credits + $10 free every month).";

export type ExaFetch = typeof fetch;

export type ExaSearchResult = {
  title: string | null;
  url: string;
  publishedDate?: string | null;
  author?: string | null;
  text?: string | null;
  highlights?: string[];
  summary?: string | null;
};

export type ExaSearchResponse = {
  results: ExaSearchResult[];
  /** Total cost in dollars reported by Exa, when present. */
  costDollars?: number | null;
};

export type ExaContentsResult = {
  title: string | null;
  url: string;
  text?: string | null;
  highlights?: string[];
  summary?: string | null;
};

export type ExaErrorCode =
  | "missing-api-key"
  | "invalid-api-key"
  | "out-of-credits"
  | "rate-limited"
  | "bad-request"
  | "server-error"
  | "network-error";

export class ExaSearchError extends Error {
  readonly code: ExaErrorCode;
  constructor(code: ExaErrorCode, message: string) {
    super(message);
    this.name = "ExaSearchError";
    this.code = code;
  }
}

export function missingExaKeyMessage(): string {
  return (
    "Exa API key is not configured. Add one in Settings → AI → Web search (Exa), " +
    `or set the EXA_API_KEY environment variable. Get a free key at ${EXA_DASHBOARD_URL} — ` +
    EXA_FREE_TIER_NOTE
  );
}

/** Explicit key wins, then EXA_API_KEY env (server-side). */
export function resolveExaApiKey(explicit?: string | null): string | null {
  const trimmed = typeof explicit === "string" ? explicit.trim() : "";
  if (trimmed) return trimmed;
  const env =
    typeof process !== "undefined"
      ? String(process.env?.EXA_API_KEY || "").trim()
      : "";
  return env || null;
}

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
};

async function postExa<T>(
  path: "/search" | "/contents",
  apiKey: string,
  body: Record<string, unknown>,
  fetchImpl: ExaFetch = fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${EXA_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ExaSearchError(
      "network-error",
      `Exa request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (res.ok) return (await res.json()) as T;

  let tag = "";
  let detail = "";
  try {
    const data = (await res.json()) as { error?: string; tag?: string };
    tag = String(data?.tag || "");
    detail = String(data?.error || "");
  } catch {
    // Non-JSON error body — fall through to status-based mapping.
  }

  if (res.status === 401 || tag === "INVALID_API_KEY") {
    throw new ExaSearchError(
      "invalid-api-key",
      `Exa rejected the API key. Check it in Settings → AI → Web search (Exa).${detail ? ` (${detail})` : ""}`,
    );
  }
  if (
    res.status === 402 ||
    tag === "NO_MORE_CREDITS" ||
    tag === "API_KEY_BUDGET_EXCEEDED" ||
    tag === "TEAM_BUDGET_EXCEEDED"
  ) {
    throw new ExaSearchError(
      "out-of-credits",
      `Exa credits are exhausted. Top up at ${EXA_DASHBOARD_URL} — the free tier adds $10 every month.${detail ? ` (${detail})` : ""}`,
    );
  }
  if (res.status === 429 || tag === "RATE_LIMIT_EXCEEDED") {
    throw new ExaSearchError("rate-limited", "Exa rate limit hit — wait a moment and retry.");
  }
  if (res.status >= 500) {
    throw new ExaSearchError("server-error", `Exa is having issues (HTTP ${res.status}). Retry shortly.`);
  }
  throw new ExaSearchError(
    "bad-request",
    `Exa request failed (HTTP ${res.status}).${detail ? ` ${detail}` : ""}`,
  );
}

export type ExaSearchOptions = {
  /** Resolved API key, or null to use EXA_API_KEY env. */
  apiKey?: string | null;
  /** 1–10 (base price covers 10). Default 5 to stretch free credits. */
  numResults?: number;
  /** Include page text + highlights inline (free for the first 10 results). */
  includeContent?: boolean;
  /** Max chars of page text per result. Default 3000. */
  maxCharacters?: number;
  fetchImpl?: ExaFetch;
};

export async function searchExa(
  query: string,
  options: ExaSearchOptions = {},
): Promise<ExaSearchResponse> {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new ExaSearchError("bad-request", "Search query is required.");
  const apiKey = resolveExaApiKey(options.apiKey ?? null);
  if (!apiKey) throw new ExaSearchError("missing-api-key", missingExaKeyMessage());

  const numResults = clampInt(options.numResults, 5, 1, 10);
  const includeContent = options.includeContent !== false;
  const maxCharacters = clampInt(options.maxCharacters, 3000, 1, 10_000);

  const data = await postExa<{ results?: ExaSearchResult[]; costDollars?: { total?: number } }>(
    "/search",
    apiKey,
    {
      query: trimmed,
      numResults,
      type: "auto",
      contents: includeContent
        ? {
            text: { maxCharacters },
            highlights: { maxCharacters: 1000 },
          }
        : undefined,
    },
    options.fetchImpl,
  );

  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    results: results.map((r) => ({
      title: r?.title ?? null,
      url: String(r?.url || ""),
      publishedDate: r?.publishedDate ?? null,
      author: r?.author ?? null,
      text: r?.text ?? null,
      highlights: Array.isArray(r?.highlights) ? r.highlights : [],
      summary: (r as { summary?: string | null })?.summary ?? null,
    })),
    costDollars: typeof data?.costDollars?.total === "number" ? data.costDollars.total : null,
  };
}

export type ExaContentsOptions = {
  apiKey?: string | null;
  /** Max chars of page text per URL. Default 6000. */
  maxCharacters?: number;
  fetchImpl?: ExaFetch;
};

export async function fetchExaContents(
  urls: string[],
  options: ExaContentsOptions = {},
): Promise<ExaContentsResult[]> {
  const clean = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || "").trim()).filter(Boolean))].slice(0, 5);
  if (clean.length === 0) throw new ExaSearchError("bad-request", "At least one URL is required.");
  const apiKey = resolveExaApiKey(options.apiKey ?? null);
  if (!apiKey) throw new ExaSearchError("missing-api-key", missingExaKeyMessage());

  const maxCharacters = clampInt(options.maxCharacters, 6000, 1, 10_000);
  const data = await postExa<{ results?: ExaContentsResult[] }>(
    "/contents",
    apiKey,
    { urls: clean, text: { maxCharacters } },
    options.fetchImpl,
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((r) => ({
    title: r?.title ?? null,
    url: String(r?.url || ""),
    text: r?.text ?? null,
    highlights: Array.isArray(r?.highlights) ? r.highlights : [],
    summary: r?.summary ?? null,
  }));
}
