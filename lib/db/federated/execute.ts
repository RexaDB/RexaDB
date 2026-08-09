import { executeFederatedQueryWithLoader } from "./execute-with-loader";
import { getFederatedNamespaces } from "./namespaces";
import { loadFederatedTable } from "./load-table";
import { resolveFederatedSources } from "./resolve-connections";
import { getDbTables } from "../db-engine";
import { getFederatedDefaultNamespace } from "./default-namespace";

export async function executeFederatedQuery(connectionString: string, query: string, params: any[] = []): Promise<any> {
  const sources = await resolveFederatedSources(connectionString);
  const byAlias = Object.fromEntries(sources.map((source) => [source.alias, source]));
  const tableCache = new Map<string, Set<string>>();
  const resolveAlias = async (table: string) => {
    const matches: string[] = [];
    for (const source of sources) {
      if (!tableCache.has(source.alias)) {
        const rows = await getDbTables(source.connectionString, source.namespace || getFederatedDefaultNamespace(source.connectionString));
        tableCache.set(source.alias, new Set((rows || []).map((name: any) => String(name))));
      }
      if (tableCache.get(source.alias)?.has(table)) {
        matches.push(source.alias);
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`Table "${table}" exists in multiple federated sources. Use alias.table syntax.`);
    }
    throw new Error(`Table "${table}" was not found in any federated source.`);
  };
  return await executeFederatedQueryWithLoader(
    query,
    params,
    getFederatedNamespaces(sources),
    async (alias, table): Promise<{ columns: Array<{ name: string; dataType: string }>; rows: Record<string, unknown>[] }> => {
      const source = byAlias[alias];
      if (!source) throw new Error(`Unknown federated source alias "${alias}".`);
      return await loadFederatedTable(source, table);
    },
    resolveAlias
  );
}
