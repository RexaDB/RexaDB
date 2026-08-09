import type { QueryResult } from "./client-types";

export const SQLITE_BUSY_RETRY_ATTEMPTS = 6;
export const SQLITE_BUSY_BASE_DELAY_MS = 40;
export const DEFAULT_SCHEMA_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
export const AUTO_SEED_CONNECTIONS =
  process.env.REXADB_DISABLE_NATIVE_DB === "1" ||
  process.env.REXADB_DISABLE_NATIVE_DB === "true" ||
  process.env.NODE_ENV !== "production";

export type SqlEditorRunQueryResult = {
  success: boolean;
  data?: QueryResult & { executionTime: number };
  error?: string;
};

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
