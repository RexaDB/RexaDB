import type { PgCompatTarget } from "./types";
import { renderDefaultExpr } from "./ddl-default";
import { quoteIdent } from "./ddl-shared";

export function renderAlterColumn(target: PgCompatTarget, change: any) {
  const column = quoteIdent(target, change?.column?.name || "");
  const alterType = String(change?.alter?.type || "");
  if (alterType === "set default") {
    if (target === "sqlite") throw new Error("SQLite does not safely support ALTER COLUMN SET DEFAULT.");
    return `ALTER COLUMN ${column} SET DEFAULT ${renderDefaultExpr(target, change.alter.default)}`;
  }
  if (alterType === "drop default") {
    if (target === "sqlite") throw new Error("SQLite does not safely support ALTER COLUMN DROP DEFAULT.");
    return `ALTER COLUMN ${column} DROP DEFAULT`;
  }
  if (alterType === "set type") {
    throw new Error(`ALTER COLUMN TYPE is not safely supported for ${target} yet.`);
  }
  if (alterType === "set not null" || alterType === "drop not null") {
    throw new Error(`ALTER COLUMN ${alterType.toUpperCase()} requires live column metadata and is not supported yet.`);
  }
  throw new Error(`Unsupported ALTER COLUMN change: ${alterType || "unknown"}.`);
}
