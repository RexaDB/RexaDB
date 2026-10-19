import { Effect } from "effect";
import { DbError } from "./effect/errors";

type DatabaseActionNames =
  | "runQuery"
  | "cancelRunningQuery"
  | "fetchSchemas"
  | "fetchTables"
  | "fetchAllTablesWithColumns"
  | "fetchTableStructure"
  | "fetchTableForeignKeys"
  | "fetchReferencedRecord"
  | "fetchDatabases"
  | "updateTableRows"
  | "deleteTableRows";

type DatabaseActions = Pick<typeof import("../lib/db/actions-core"), DatabaseActionNames>;

function fromDatabaseAction<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

/** Effect facade for SQL execution and core schema/table actions. */
export function createDatabaseActionEffects(actions: DatabaseActions) {
  return {
    runQuery: (...args: Parameters<DatabaseActions["runQuery"]>) => fromDatabaseAction(
      "Failed to run SQL query",
      () => actions.runQuery(...args),
    ),
    cancelQuery: (...args: Parameters<DatabaseActions["cancelRunningQuery"]>) => fromDatabaseAction(
      "Failed to cancel SQL query",
      () => actions.cancelRunningQuery(...args),
    ),
    fetchSchemas: (...args: Parameters<DatabaseActions["fetchSchemas"]>) => fromDatabaseAction(
      "Failed to fetch schemas",
      () => actions.fetchSchemas(...args),
    ),
    fetchTables: (...args: Parameters<DatabaseActions["fetchTables"]>) => fromDatabaseAction(
      "Failed to fetch tables",
      () => actions.fetchTables(...args),
    ),
    fetchAllTablesWithColumns: (...args: Parameters<DatabaseActions["fetchAllTablesWithColumns"]>) => fromDatabaseAction(
      "Failed to fetch tables and columns",
      () => actions.fetchAllTablesWithColumns(...args),
    ),
    fetchTableStructure: (...args: Parameters<DatabaseActions["fetchTableStructure"]>) => fromDatabaseAction(
      "Failed to fetch table structure",
      () => actions.fetchTableStructure(...args),
    ),
    fetchTableForeignKeys: (...args: Parameters<DatabaseActions["fetchTableForeignKeys"]>) => fromDatabaseAction(
      "Failed to fetch table foreign keys",
      () => actions.fetchTableForeignKeys(...args),
    ),
    fetchReferencedRecord: (...args: Parameters<DatabaseActions["fetchReferencedRecord"]>) => fromDatabaseAction(
      "Failed to fetch referenced record",
      () => actions.fetchReferencedRecord(...args),
    ),
    fetchDatabases: (...args: Parameters<DatabaseActions["fetchDatabases"]>) => fromDatabaseAction(
      "Failed to fetch databases",
      () => actions.fetchDatabases(...args),
    ),
    updateTableRows: (...args: Parameters<DatabaseActions["updateTableRows"]>) => fromDatabaseAction(
      "Failed to update table rows",
      () => actions.updateTableRows(...args),
    ),
    deleteTableRows: (...args: Parameters<DatabaseActions["deleteTableRows"]>) => fromDatabaseAction(
      "Failed to delete table rows",
      () => actions.deleteTableRows(...args),
    ),
  };
}
