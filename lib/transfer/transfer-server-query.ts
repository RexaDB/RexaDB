/**
 * Server-only query implementation for transfers.
 *
 * IMPORTANT: this module (and the adapters that import it) must never be
 * reachable from client bundles — it pulls in the direct DB implementation
 * (`actions-core`, pg drivers, etc.). Adapters stay server-only because
 * `createTransferService` loads them through dynamic imports guarded by
 * `process.versions?.node`, and nothing client-side imports them.
 *
 * Importing this module registers the server implementation for dual-use
 * modules (`storage-utils`, `auth/fetch`) that call `transferQuery()`.
 */

import { registerTransferQuery } from "./transfer-sql";
import type { QueryFnResult } from "./transfer-sql";

export async function serverTransferQuery(
  connectionString: string,
  sql: string,
): Promise<QueryFnResult> {
  const { runQuery } = await import("@/lib/db/actions-core");
  const res = await runQuery(connectionString, sql);
  return {
    success: res.success,
    data: res.data ? { rows: res.data.rows as Array<Record<string, unknown>> } : undefined,
    error: (res as { error?: unknown }).error,
  };
}

// Register on import so any server process that loads the transfer
// adapters automatically wires up dual-use callers.
registerTransferQuery(serverTransferQuery);
