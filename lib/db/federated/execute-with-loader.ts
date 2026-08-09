import { compilePostgresQuery } from "../postgres-compat";
import { parsePostgresStatement } from "../postgres-compat/ast";
import { normalizePgSyntax } from "../postgres-compat/normalize";
import { collectFederatedRefs } from "./collect-refs";
import { compactFederatedQuery } from "./compact-query";
import { toPlainFederatedRows } from "./plain-row";
import { buildFederatedFields } from "./result-fields";
import { buildFederatedColumnMap, buildFederatedQueryFromStatement } from "./set-ops";
import { toFederatedSqliteType } from "./sqlite-affinity";
import { createFederatedTempTable, insertFederatedTempRow, withFederatedTempDb } from "./temp-db";

export async function executeFederatedQueryWithLoader(
  query: string,
  params: any[],
  namespaces: Record<string, string>,
  loadTable: (alias: string, table: string, namespace: string) => Promise<{ columns: Array<{ name: string; dataType: string }>; rows: Record<string, unknown>[] }>,
  resolveAlias?: (table: string) => Promise<string>
) {
  const normalized = normalizePgSyntax(query);
  const statement = parsePostgresStatement(normalized);
  const statementType = String(statement?.type || "");
  if (!["select", "with", "union", "union all", "intersect", "except"].includes(statementType)) {
    throw new Error("Federated queries currently support SELECT, WITH, and set-operation statements only.");
  }
  const refs = await collectFederatedRefs(statement, namespaces, resolveAlias);
  const loaded = await Promise.all(refs.map(async (ref) => ({
    ref,
    data: await loadTable(ref.alias, ref.table, ref.namespace),
  })));
  const rewritten = compactFederatedQuery(
    buildFederatedQueryFromStatement(statement, refs, buildFederatedColumnMap(loaded))
  );
  const compiled = compilePostgresQuery(rewritten, params, "sqlite");

  return await withFederatedTempDb(async (client) => {
    for (const entry of loaded) {
      await createFederatedTempTable(
        client,
        entry.ref.tempTable,
        entry.data.columns.map((column) => ({ name: column.name, type: toFederatedSqliteType(column.dataType) }))
      );
      for (const row of entry.data.rows) {
        await insertFederatedTempRow(client, entry.ref.tempTable, row);
      }
    }
    const result = await client.execute({ sql: compiled.query, args: compiled.params });
    const rows = toPlainFederatedRows((result.rows as unknown[]) || []);
    return { rows, fields: buildFederatedFields(rows), rowCount: rows.length };
  });
}
