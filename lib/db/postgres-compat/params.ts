import type { CompiledQuery } from "./types";

export function compilePgParams(query: string, params: any[]): CompiledQuery {
  const compiledParams: any[] = [];
  const compiledQuery = String(query || "").replace(/\$(\d+)/g, (_, rawIndex) => {
    const index = Number(rawIndex) - 1;
    compiledParams.push(index >= 0 ? params[index] : undefined);
    return "?";
  });
  return { query: compiledQuery, params: compiledParams };
}
