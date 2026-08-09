import type { QueryExecutionContext } from "@/lib/studio/table-permissions";

export type QueryOptions = {
  queryId?: string;
  executionContext?: QueryExecutionContext | null;
};

export type SqlEngineKind = "postgres" | "sqlite" | "mysql";

export type RowUpdate = {
  where: Record<string, any>;
  set: Record<string, any>;
};
