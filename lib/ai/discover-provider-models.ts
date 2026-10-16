// utils
import { getPiProviderMeta } from "./pi-provider-catalog";

// types
import type { AiProviderModel } from "./provider-model-types";

type ModelDiscoveryInput = {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
};

type ModelRecord = Record<string, unknown>;

const NON_CHAT_MODEL_PATTERNS = [
  /(?:^|[/:])(?:text-(?:embedding|search|similarity|moderation)|(?:omni-)?moderation|whisper|tts|dall[-·]e|(?:chat)?gpt-image|sora)(?:[-:.]|$)/i,
  /(?:^|[-/:_])(?:embed(?:ding|dings)?|rerank(?:er)?|transcribe|transcription|realtime|tts)(?:[-/:_]|$)/i,
  /(?:^|[/:])(?:(?:text|code)-)?(?:davinci|babbage|curie|ada)(?:[-:]|$)/i,
];

function isChatCapableModel(id: string, record: ModelRecord): boolean {
  if (NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(id))) return false;

  const outputModalities = asRecord(record.architecture).output_modalities;
  if (Array.isArray(outputModalities) && !outputModalities.includes("text")) return false;

  // openai-compatible lists can omit capabilities, so unknown custom ids remain available.
  return true;
}

function asRecord(value: unknown): ModelRecord {
  return value !== null && typeof value === "object" ? value as ModelRecord : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildDiscoveryRequest(input: ModelDiscoveryInput) {
  if (!input || typeof input.provider !== "string" || !input.provider.trim()) {
    throw new Error("Choose a provider first.");
  }

  const meta = getPiProviderMeta(input.provider);
  const baseUrl = nonEmptyString(input.baseUrl) || meta?.baseUrl || (
    input.provider === "ollama" ? "http://localhost:11434/v1" :
    input.provider === "kilo" ? "https://api.kilo.ai/api/gateway" : undefined
  );
  if (!baseUrl) throw new Error("Enter a base URL to discover models.");

  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use an HTTP or HTTPS base URL without embedded credentials.");
  }
  const apiKey = nonEmptyString(input.apiKey);
  const format = input.provider === "anthropic" ? "anthropic" :
    input.provider === "google" ? "google" : "openai";
  if (format === "openai" && meta?.api && !meta.api.startsWith("openai-") && !nonEmptyString(input.baseUrl)) {
    throw new Error("Live discovery is unavailable for this provider. Choose from the catalog or enter a model ID.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const path = url.pathname.replace(/\/+$/, "");
  if (format === "google") {
    url.pathname = `${/\/v1(beta)?$/.test(path) ? path : `${path}/v1beta`}/models`;
    url.searchParams.set("pageSize", "1000");
    if (apiKey) headers["x-goog-api-key"] = apiKey;
  } else {
    const versionedPath = format === "anthropic" && !/\/v1$/.test(path) ? `${path}/v1` : path;
    url.pathname = `${versionedPath}/models`;
    if (format === "anthropic") {
      headers["anthropic-version"] = "2023-06-01";
      if (apiKey) headers["x-api-key"] = apiKey;
      url.searchParams.set("limit", "1000");
    } else if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  return { url, headers, format };
}

export async function fetchAiProviderModels(input: ModelDiscoveryInput): Promise<AiProviderModel[]> {
  const { url, headers, format } = buildDiscoveryRequest(input);
  const signal = AbortSignal.timeout(20_000);
  const models = new Map<string, AiProviderModel>();
  const cursors = new Set<string>();

  for (let page = 0; page < 50; page++) {
    const response = await fetch(url, { headers, signal, redirect: "error" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Model discovery was denied. Check your API key and provider permissions.");
      }
      if (response.status === 404 || response.status === 405) {
        throw new Error("This endpoint does not support model discovery. Choose from the catalog or enter a model ID.");
      }
      throw new Error(`Could not load models (HTTP ${response.status}). Try again or enter a model ID.`);
    }

    const body = asRecord(await response.json());
    const items = format === "google" ? body.models : body.data;
    if (!Array.isArray(items)) throw new Error("The provider returned an unsupported model list. Enter a model ID instead.");

    for (const item of items) {
      const record = asRecord(item);
      if (format === "google" && (!Array.isArray(record.supportedGenerationMethods) || !record.supportedGenerationMethods.includes("generateContent"))) continue;
      const rawId = nonEmptyString(format === "google" ? record.name : record.id);
      if (!rawId) continue;
      const id = format === "google" ? rawId.replace(/^models\//, "") : rawId;
      if (format === "openai" && !isChatCapableModel(id, record)) continue;
      const name = nonEmptyString(record.display_name) || nonEmptyString(record.displayName) ||
        (format === "google" ? id : nonEmptyString(record.name)) || id;
      models.set(id, { id, name });
    }

    const cursor = format === "google" ? nonEmptyString(body.nextPageToken) :
      body.has_more === true ? nonEmptyString(body.last_id) : undefined;
    if (!cursor) {
      if (body.has_more === true) throw new Error("The provider returned an incomplete model list. Try again.");
      return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (cursors.has(cursor)) throw new Error("The provider repeated a model page. Try again.");
    cursors.add(cursor);
    url.searchParams.set(format === "google" ? "pageToken" : "after_id", cursor);
  }

  throw new Error("The provider returned too many model pages. Enter a model ID instead.");
}

export async function discoverAiProviderModels(input: ModelDiscoveryInput) {
  try {
    return { success: true, data: await fetchAiProviderModels(input) };
  } catch (error) {
    const message = error instanceof Error && error.name === "Error" ? error.message :
      "Could not reach the provider or the request timed out. Check your base URL and try again.";
    return { success: false, error: message };
  }
}
