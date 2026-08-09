import { getFederatedTempTableName } from "./temp-table-name";
import type { FederatedTableRef } from "./types";

function rewriteFederatedTableRef(table: any, refs: FederatedTableRef[]) {
  if (table?.type !== "table") return;
  const alias = String(table?.name?.schema || "");
  const tableName = String(table?.name?.name || "");
  const ref = refs.find((entry) => entry.inputSchema === alias && entry.table === tableName);
  if (!ref) return;
  table.name = {
    name: getFederatedTempTableName(ref.alias, ref.table),
    alias: table?.name?.alias,
  };
}

export function walkAstFromAndWith(statement: any, refs: FederatedTableRef[], visit: (stmt: any) => void) {
  if (Array.isArray(statement?.from)) {
    statement.from.forEach((entry: any) => {
      rewriteFederatedTableRef(entry, refs);
      if (entry?.type === "statement") visit(entry.statement);
    });
  }
  if (statement?.type === "with") {
    (statement.bind || []).forEach((binding: any) => visit(binding?.statement));
    visit(statement.in);
  }
}
