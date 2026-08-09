import { ToolRegistry } from "@/tools/registry";
import { postgresTools } from "@/tools/postgres";

export type DatabaseProvider = "postgres";

function toolsForDatabaseProvider(provider: DatabaseProvider) {
  switch (provider) {
    case "postgres":
      return postgresTools;
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${String(exhaustive)}`);
    }
  }
}

export function createToolRegistry(provider: DatabaseProvider = "postgres"): ToolRegistry {
  return new ToolRegistry(toolsForDatabaseProvider(provider));
}

export function listToolCatalog(provider: DatabaseProvider = "postgres") {
  return createToolRegistry(provider).catalog();
}

export function getOpenAITools(provider: DatabaseProvider = "postgres", strict: boolean = true) {
  return createToolRegistry(provider).toOpenAIFunctionTools(strict);
}

export function getGeminiTools(provider: DatabaseProvider = "postgres") {
  return createToolRegistry(provider).toGeminiTools();
}
