import type { QueryResult } from "@/lib/db/client-types";
import { getConfigsByViewMode, getTabConfig, getViewMode } from "@/lib/studio/tab-registry";

export interface ResultTabInfo {
  id: string;
  label: string;
  query: string;
  results: (QueryResult & { executionTime: number }) | null;
  error: string | null;
  executionTime: number;
}

export interface SqlTabState {
  loading: boolean;
  executionTime: number;
  error: string | null;
  results: (QueryResult & { executionTime: number }) | null;
  activeQueryId: string | null;
  activeQueryIds: string[];
  resultTabs: ResultTabInfo[];
  activeResultTabId: string | null;
}

export const DATABASE_TAB_TYPES = getConfigsByViewMode("database").map((config) => config.type);

export function isDatabaseTabType(tabType: string): boolean {
  return getTabConfig(tabType)?.group === "database";
}

export const TAB_TYPE_TO_DATABASE_VIEW: Record<string, string> = Object.fromEntries(
  getConfigsByViewMode("database")
    .filter((config) => !config.type.startsWith("database-spacetimedb"))
    .map((config) => [config.type, config.type.replace(/^database-/, "")]),
);

export function resolveTabViewMode(tab: { type: string } | null | undefined, fallbackMode: string): string {
  if (!tab) return fallbackMode;
  return getViewMode(tab.type) ?? fallbackMode;
}
