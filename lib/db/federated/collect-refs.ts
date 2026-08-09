import { getFederatedTempTableName } from "./temp-table-name";
import type { FederatedTableRef } from "./types";

function pushRef(into: FederatedTableRef[], schema: string, table: string, namespace: string, inputSchema: string) {
  if (!schema || !table) return;
  if (into.some((entry) => entry.inputSchema === inputSchema && entry.table === table)) return;
  into.push({ alias: schema, inputSchema, table, namespace, tempTable: getFederatedTempTableName(schema, table) });
}

async function walk(
  statement: any,
  namespaces: Record<string, string>,
  refs: FederatedTableRef[],
  resolveAlias?: (table: string) => Promise<string>
) {
  if (!statement || typeof statement !== "object") return;
  if (statement?.left || statement?.right) {
    await walk(statement.left, namespaces, refs, resolveAlias);
    await walk(statement.right, namespaces, refs, resolveAlias);
  }
  if (Array.isArray(statement?.from)) {
    for (const entry of statement.from) {
      if (entry?.type === "table") {
        const inputSchema = String(entry?.name?.schema || "");
        const tableName = String(entry?.name?.name || "");
        const resolvedAlias = inputSchema || (tableName && resolveAlias ? await resolveAlias(tableName) : "");
        pushRef(refs, resolvedAlias, tableName, namespaces[resolvedAlias] || "", inputSchema);
      }
      if (entry?.type === "statement") await walk(entry.statement, namespaces, refs, resolveAlias);
    }
  }
  if (statement?.type === "with") {
    for (const binding of statement.bind || []) await walk(binding?.statement, namespaces, refs, resolveAlias);
    await walk(statement.in, namespaces, refs, resolveAlias);
  }
}

export async function collectFederatedRefs(
  statement: any,
  namespaces: Record<string, string>,
  resolveAlias?: (table: string) => Promise<string>
) {
  const refs: FederatedTableRef[] = [];
  await walk(statement, namespaces, refs, resolveAlias);
  return refs;
}
