import { describe, expect, test } from "bun:test";

import { discoverAiProviderModels, fetchAiProviderModels } from "@/lib/ai/discover-provider-models";
import { listAiProviderCatalog } from "@/lib/ai/pi-provider-catalog";

async function withProvider(
  respond: (request: Request) => Response | Promise<Response>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: respond });
  try {
    await run(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
}

describe("provider model discovery", () => {
  test("exposes SDK model choices without credentials", async () => {
    const result = await listAiProviderCatalog();
    const openai = result.data?.find((provider) => provider.id === "openai");
    expect(openai?.models.length).toBeGreaterThan(0);
    expect(openai?.models[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
  });

  test("preserves gateway paths, authenticates, and deduplicates models", async () => {
    await withProvider((request) => {
      expect(new URL(request.url).pathname).toBe("/gateway/v1/models");
      expect(request.headers.get("authorization")).toBe("Bearer secret-key");
      return Response.json({ data: [{ id: "z", name: "Zebra" }, { id: "a", name: "Alpha" }, { id: "a", name: "Alpha" }, {}, null] });
    }, async (baseUrl) => {
      expect(await fetchAiProviderModels({ provider: "custom", apiKey: "secret-key", baseUrl: `${baseUrl}/gateway/v1/` })).toEqual([
        { id: "a", name: "Alpha" }, { id: "z", name: "Zebra" },
      ]);
    });
  });

  test("supports keyless Ollama through its OpenAI-compatible endpoint", async () => {
    await withProvider((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/models");
      expect(request.headers.has("authorization")).toBe(false);
      return Response.json({ data: [{ id: "local-model:latest" }] });
    }, async (baseUrl) => {
      expect(await fetchAiProviderModels({ provider: "ollama", baseUrl: `${baseUrl}/v1` })).toEqual([
        { id: "local-model:latest", name: "local-model:latest" },
      ]);
    });
  });

  test("paginates Anthropic and uses native authentication", async () => {
    let calls = 0;
    await withProvider((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/v1/models");
      expect(request.headers.get("x-api-key")).toBe("anthropic-key");
      expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
      calls++;
      if (calls === 1) return Response.json({ data: [{ id: "claude-a", display_name: "Claude A" }], has_more: true, last_id: "claude-a" });
      expect(url.searchParams.get("after_id")).toBe("claude-a");
      return Response.json({ data: [{ id: "claude-b", display_name: "Claude B" }], has_more: false });
    }, async (baseUrl) => {
      expect(await fetchAiProviderModels({ provider: "anthropic", apiKey: "anthropic-key", baseUrl: `${baseUrl}/v1/` })).toHaveLength(2);
      expect(calls).toBe(2);
    });
  });

  test("paginates Google and excludes models without generateContent", async () => {
    await withProvider((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/v1beta/models");
      expect(request.headers.get("x-goog-api-key")).toBe("google-key");
      if (!url.searchParams.has("pageToken")) {
        return Response.json({ models: [
          { name: "models/gemini-a", displayName: "Gemini A", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding", supportedGenerationMethods: ["embedContent"] },
        ], nextPageToken: "next" });
      }
      expect(url.searchParams.get("pageToken")).toBe("next");
      return Response.json({ models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] });
    }, async (baseUrl) => {
      expect(await fetchAiProviderModels({ provider: "google", apiKey: "google-key", baseUrl })).toEqual([
        { id: "gemini-a", name: "Gemini A" }, { id: "gemini-b", name: "gemini-b" },
      ]);
    });
  });

  test("excludes non-chat OpenAI-compatible models", async () => {
    await withProvider(() => Response.json({ data: [
      { id: "gpt-4o" },
      { id: "text-embedding-3-large" },
      { id: "whisper-1" },
      { id: "gpt-4o-mini-tts" },
      { id: "dall-e-3" },
      { id: "gpt-image-1" },
      { id: "omni-moderation-latest" },
    ] }), async (baseUrl) => {
      expect(await fetchAiProviderModels({ provider: "custom", baseUrl })).toEqual([
        { id: "gpt-4o", name: "gpt-4o" },
      ]);
    });
  });

  test("filters namespaced and specialized model IDs without excluding custom chat models", async () => {
    const excluded = [
      "gpt-4o-transcribe", "gpt-4o-mini-transcribe-2025-12-15", "chatgpt-image-latest",
      "sora-2", "gpt-realtime", "gpt-4o-realtime-preview", "davinci-002", "babbage-002",
      "text-davinci-003", "ft:davinci-002:team:custom:id", "openai/text-embedding-3-large",
      "nomic-embed-text:latest", "mxbai-embed-large", "qwen3-embedding:8b",
      "BAAI/bge-reranker-v2-m3", "cohere/rerank-v3.5",
    ];
    const included = ["gpt-4o", "o3", "openai/gpt-4.1", "deepseek-chat", "my-private-model", "embedded-chat", "llama3.2-vision:latest"];

    await withProvider(() => Response.json({ data: [...excluded, ...included].map((id) => ({ id })) }), async (baseUrl) => {
      const models = await fetchAiProviderModels({ provider: "custom", baseUrl });
      expect(models.map((model) => model.id).sort()).toEqual([...included].sort());
    });
  });

  test("requires text output when a gateway provides output modality metadata", async () => {
    await withProvider(() => Response.json({ data: [
      { id: "vendor/visual-model", architecture: { output_modalities: ["image"] } },
      { id: "vendor/speech-model", architecture: { output_modalities: ["audio"] } },
      { id: "vendor/vector-model", architecture: { output_modalities: ["embeddings"] } },
      { id: "vendor/video-model", architecture: { output_modalities: ["video"] } },
      { id: "vendor/chat-model", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
      { id: "vendor/multimodal-chat", architecture: { output_modalities: ["text", "audio"] } },
      { id: "vendor/custom-chat" },
    ] }), async (baseUrl) => {
      const models = await fetchAiProviderModels({ provider: "openrouter", baseUrl });
      expect(models.map((model) => model.id).sort()).toEqual(["vendor/chat-model", "vendor/custom-chat", "vendor/multimodal-chat"]);
    });
  });

  test("handles empty lists and rejects malformed payloads", async () => {
    await withProvider(() => Response.json({ data: [] }), async (baseUrl) => {
      expect(await fetchAiProviderModels({ provider: "custom", baseUrl })).toEqual([]);
    });
    await withProvider(() => Response.json({ models: [] }), async (baseUrl) => {
      expect(await discoverAiProviderModels({ provider: "custom", baseUrl })).toMatchObject({ success: false, error: expect.stringContaining("unsupported model list") });
    });
  });

  test("returns actionable auth and unsupported-endpoint errors without echoing provider secrets", async () => {
    for (const status of [401, 403, 404, 405, 500]) {
      await withProvider(() => Response.json({ error: "secret-key" }, { status }), async (baseUrl) => {
        const result = await discoverAiProviderModels({ provider: "custom", apiKey: "secret-key", baseUrl });
        expect(result.success).toBe(false);
        expect(result.error).not.toContain("secret-key");
        expect(result.error).toMatch(status < 404 ? /API key/ : status < 500 ? /does not support/ : /HTTP 500/);
      });
    }
  });

  test("rejects repeated pagination cursors", async () => {
    await withProvider(() => Response.json({ data: [], has_more: true, last_id: "same" }), async (baseUrl) => {
      expect(await discoverAiProviderModels({ provider: "anthropic", baseUrl })).toMatchObject({ success: false, error: expect.stringContaining("repeated") });
    });
  });

  test("does not follow redirects carrying credentials", async () => {
    let redirected = false;
    await withProvider((request) => {
      if (new URL(request.url).pathname === "/models") return Response.redirect(new URL("/redirected", request.url));
      redirected = true;
      return Response.json({ data: [] });
    }, async (baseUrl) => {
      expect((await discoverAiProviderModels({ provider: "custom", apiKey: "secret", baseUrl })).success).toBe(false);
      expect(redirected).toBe(false);
    });
  });

  test("rejects unsafe protocols and embedded credentials", async () => {
    for (const baseUrl of ["file:///etc/passwd", "http://user:secret@localhost/v1"]) {
      expect((await discoverAiProviderModels({ provider: "custom", baseUrl })).success).toBe(false);
    }
  });
});
