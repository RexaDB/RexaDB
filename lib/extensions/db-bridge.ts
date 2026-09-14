/**
 * Live DB bridge — connects the extension host to the active studio session.
 * Registered by `StudioInterface` on mount (it owns the `useStudio()` state);
 * the `ExtensionProvider` (mounted at the app root) reads it when extensions
 * call `rexa.rexaDb.*`. Null when no studio session is active (e.g. the
 * connections list) — calls then fall back to safe empty values.
 * The provider re-runs extension activation on every (re)registration
 * (`onExtensionBridgeChange`), so activation-time snapshots pick up live data
 * once a session opens instead of the startup empty fallbacks.
 */

export interface ExtensionTableColumn {
  name: string;
  type?: string;
  nullable?: boolean;
}

export interface ExtensionTableInfo {
  schema: string;
  name: string;
  columns: ExtensionTableColumn[];
}

export interface ExtensionSchemaInfo {
  database: string;
  dbType: string;
  schemas: string[];
  tables: ExtensionTableInfo[];
}

export interface ExtensionConnectionInfo {
  id: number;
  name: string;
  dbType: string;
}

export interface ExtensionDbBridge {
  getConnections(): Promise<ExtensionConnectionInfo[]>;
  getActiveConnection(): Promise<ExtensionConnectionInfo | null>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; fields: string[] }>;
  getSchema(): Promise<ExtensionSchemaInfo>;
  readTable(schema: string, table: string, limit?: number): Promise<{ rows: unknown[]; fields: string[] }>;
  getActiveQuery(): Promise<string>;
  setActiveQuery(sql: string): Promise<void>;
}

let current: ExtensionDbBridge | null = null;

type BridgeListener = (bridge: ExtensionDbBridge | null) => void;
const listeners = new Set<BridgeListener>();

/**
 * Subscribe to studio-session availability. Fires when a session opens
 * (bridge registered) or closes (unregistered) — the extension provider uses
 * this to re-run activation so extensions see live data instead of the
 * empty fallbacks they snapshotted at app startup.
 */
export function onExtensionBridgeChange(fn: BridgeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn(current);
    } catch {
      // Listener errors must never break bridge registration.
    }
  }
}

export function registerExtensionDbBridge(bridge: ExtensionDbBridge): void {
  current = bridge;
  emit();
}

export function unregisterExtensionDbBridge(bridge: ExtensionDbBridge): void {
  if (current === bridge) {
    current = null;
    emit();
  }
}

export function getExtensionDbBridge(): ExtensionDbBridge | null {
  return current;
}

/** Best-effort client-side write guard. The server is authoritative. */
export function isWriteQuery(sql: string): boolean {
  const withoutComments = sql
    .replace(/--[^\n]*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  if (/;\s*\S/.test(withoutComments)) return true; // multi-statement
  return /^\s*(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|replace|vacuum|reindex|comment|security|copy)\b/i.test(
    withoutComments,
  );
}
