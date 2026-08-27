import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

/**
 * Provider metadata straight from the installed Pi agent SDK — id, display
 * name, default base URL, and native API format. Read live (not hand-copied)
 * so RexaDB automatically picks up whatever providers the SDK ships with,
 * including ones added in future SDK updates.
 */
export type PiProviderMeta = {
  id: string;
  name: string;
  baseUrl?: string;
  api?: string;
};

let cache: PiProviderMeta[] | null = null;

function buildCatalog(): PiProviderMeta[] {
  return builtinProviders()
    .map((provider) => {
      const models = provider.getModels();
      return {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl || models[0]?.baseUrl || undefined,
        api: models[0]?.api,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every provider the installed Pi agent SDK ships with. */
export function listPiProviderCatalog(): PiProviderMeta[] {
  if (!cache) cache = buildCatalog();
  return cache;
}

export function getPiProviderMeta(id: string): PiProviderMeta | undefined {
  return listPiProviderCatalog().find((p) => p.id === id);
}

export async function listAiProviderCatalog() {
  try {
    const data = listPiProviderCatalog().map(({ id, name, baseUrl }) => ({ id, name, baseUrl }));
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load provider catalog.",
    };
  }
}
