// Server-only. Watches one table for committed changes so the data grid can
// refresh live. Imported only by server/index.ts — the Neon Realtime secret and
// the Supabase service_role key never leave the sidecar.
//
// Neon: a direct live query (@neon/realtime) over the grid's visible window.
// Supabase: a postgres_changes channel over the whole table, which needs the
// table in the `supabase_realtime` publication.
import { createRealtime, rawSql } from "@neon/realtime/server";
import { createClient } from "@supabase/supabase-js";
import { getRealtimeSecret, getRealtimeState } from "@/lib/neon-oauth/api";
import { parseNeonCliConnectionString } from "@/lib/neon-cli/pointer";
import { parseSupabaseMgmtConnectionString, executeSupabaseMgmtQuery } from "@/lib/db/supabase-mgmt-client";
import { resolveSupabaseApiCreds } from "@/lib/transfer/supabase-api";
import { quotePgIdentifier as quoteIdent } from "@/lib/db/quote-identifier";
import {
  REALTIME_ERROR,
  type RealtimeErrorCode,
  type TableWatchEvent,
  type TableWatchRequest,
} from "./types";

export class TableWatchError extends Error {
  constructor(
    public readonly code: RealtimeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Emit = (event: TableWatchEvent) => void;

/** Starts watching; resolves to a stop function once the subscription is open. */
export async function watchTable(request: TableWatchRequest, emit: Emit): Promise<() => void> {
  const neon = parseNeonCliConnectionString(request.connectionString);
  if (neon) return watchNeonTable(neon, request, emit);
  if (parseSupabaseMgmtConnectionString(request.connectionString)) {
    return watchSupabaseTable(request, emit);
  }
  throw new TableWatchError(
    REALTIME_ERROR.unsupported,
    "Live updates need a Neon or Supabase connection signed in through its management API.",
  );
}

/** The grid's visible window: its filter and sort, with the primary key as a
 *  tiebreak so the order is deterministic (live queries require that). */
export function buildNeonWindowSql(request: TableWatchRequest): string {
  const sortColumn = request.sort?.column;
  const order = [
    ...(sortColumn ? [`${quoteIdent(sortColumn)} ${request.sort!.direction === "DESC" ? "DESC" : "ASC"}`] : []),
    ...request.primaryKey.filter((column) => column !== sortColumn).map((column) => `${quoteIdent(column)} ASC`),
  ];
  const filter = request.filter?.trim();
  return (
    `SELECT * FROM ${quoteIdent(request.schema)}.${quoteIdent(request.table)}` +
    (filter ? ` WHERE ${filter}` : "") +
    ` ORDER BY ${order.join(", ")} LIMIT $1 OFFSET $2`
  );
}

async function watchNeonTable(
  pointer: NonNullable<ReturnType<typeof parseNeonCliConnectionString>>,
  request: TableWatchRequest,
  emit: Emit,
): Promise<() => void> {
  const { profile, projectId, branchId, database } = pointer;
  const state = await getRealtimeState(profile, projectId, branchId);
  if (!state.enabled || state.pending || !state.invocation_url) {
    throw new TableWatchError(
      state.enabled ? REALTIME_ERROR.pending : REALTIME_ERROR.disabled,
      state.enabled
        ? "Realtime is still being set up on this branch. Try again in a moment."
        : "Realtime is not enabled on this Neon branch.",
    );
  }
  if (request.primaryKey.length === 0) {
    throw new TableWatchError(
      REALTIME_ERROR.noPrimaryKey,
      "Neon live queries need a primary key to identify rows.",
    );
  }

  const secret = await getRealtimeSecret(profile, projectId, branchId);
  // debugMode returns Postgres' own error instead of a bare "upstream
  // rejected". It is meant for development because it exposes schema details
  // to clients; here the only client is the database owner's own studio.
  const realtime = createRealtime({ url: state.invocation_url, secret, db: database, debugMode: true });
  const query = rawSql<Record<string, unknown>>(buildNeonWindowSql(request), [request.limit, request.offset]);

  let subscription;
  try {
    subscription = await realtime.subscribe(query, { materialize: false });
  } catch (error) {
    realtime.close();
    throw new Error(describeLiveQueryError(error));
  }
  subscription.onStateChange((s) => {
    if (s.status === "error") emit({ type: "error", message: describeLiveQueryError(s.error) });
    else emit({ type: "status", status: s.status });
  });
  subscription.onUpdate((update) => {
    if (update.type === "changes" && update.changes.length > 0) {
      emit({ type: "change", count: update.changes.length });
    }
  });
  return () => {
    subscription.unsubscribe();
    realtime.close();
  };
}

/** The SDK's message plus its error code and SQLSTATE, which say whether
 *  Postgres rejected the query (e.g. 42501 permission, 42P01 missing table). */
export function describeLiveQueryError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // The beta rejects any query touching a table with row-level security.
  if (/row security/i.test(error.message)) {
    return "Neon Realtime (beta) doesn't support tables with row-level security yet. Disable RLS on this table or use Auto-refresh.";
  }
  const { code, sqlState } = error as Error & { code?: unknown; sqlState?: unknown };
  const details = [
    typeof code === "string" && code ? code : null,
    typeof sqlState === "string" && sqlState ? `SQLSTATE ${sqlState}` : null,
  ].filter(Boolean);
  return details.length ? `${error.message} (${details.join(", ")})` : error.message;
}

/** True when the table is in the publication Supabase Realtime reads from. */
export async function isSupabaseTablePublished(
  connectionString: string,
  schema: string,
  table: string,
): Promise<boolean> {
  const { rows } = await executeSupabaseMgmtQuery(
    connectionString,
    `SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = $1 AND tablename = $2`,
    [schema, table],
  );
  return rows.length > 0;
}

export interface SupabaseTableRealtimeStatus {
  published: boolean;
  /** REPLICA IDENTITY FULL — UPDATE/DELETE events carry the old row. */
  fullReplicaIdentity: boolean;
}

export async function getSupabaseTableRealtimeStatus(
  connectionString: string,
  schema: string,
  table: string,
): Promise<SupabaseTableRealtimeStatus> {
  const { rows } = await executeSupabaseMgmtQuery(
    connectionString,
    `SELECT c.relreplident::text AS ident,
            EXISTS (SELECT 1 FROM pg_publication_tables p
                    WHERE p.pubname = 'supabase_realtime' AND p.schemaname = n.nspname AND p.tablename = c.relname) AS published
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, table],
  );
  const row = rows[0];
  return {
    published: row?.published === true || row?.published === "t" || row?.published === "true",
    fullReplicaIdentity: row?.ident === "f",
  };
}

export async function setSupabaseTableRealtime(
  connectionString: string,
  schema: string,
  table: string,
  changes: { published?: boolean; fullReplicaIdentity?: boolean },
): Promise<SupabaseTableRealtimeStatus> {
  const target = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  if (changes.published !== undefined) {
    const { published } = await getSupabaseTableRealtimeStatus(connectionString, schema, table);
    if (changes.published !== published) {
      // Projects created before Realtime existed may lack the publication.
      await executeSupabaseMgmtQuery(
        connectionString,
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
             CREATE PUBLICATION supabase_realtime;
           END IF;
         END $$;
         ALTER PUBLICATION supabase_realtime ${changes.published ? "ADD" : "DROP"} TABLE ${target};`,
      );
    }
  }
  if (changes.fullReplicaIdentity !== undefined) {
    await executeSupabaseMgmtQuery(
      connectionString,
      `ALTER TABLE ${target} REPLICA IDENTITY ${changes.fullReplicaIdentity ? "FULL" : "DEFAULT"}`,
    );
  }
  return getSupabaseTableRealtimeStatus(connectionString, schema, table);
}

async function watchSupabaseTable(request: TableWatchRequest, emit: Emit): Promise<() => void> {
  const { schema, table, connectionString } = request;
  if (!(await isSupabaseTablePublished(connectionString, schema, table))) {
    throw new TableWatchError(
      REALTIME_ERROR.notPublished,
      `"${schema}.${table}" is not in the supabase_realtime publication.`,
    );
  }
  const { creds, warning } = await resolveSupabaseApiCreds(connectionString);
  if (!creds) {
    throw new TableWatchError(REALTIME_ERROR.unsupported, warning ?? "No Supabase service key.");
  }

  // service_role bypasses RLS, so the grid sees every row's changes.
  const client = createClient(creds.projectUrl, creds.serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const channel = client
    .channel(`rexadb:${schema}.${table}:${Date.now()}`)
    .on("postgres_changes", { event: "*", schema, table }, () => {
      emit({ type: "change", count: 1 });
    });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        emit({ type: "status", status: "live" });
        if (!settled) {
          settled = true;
          resolve();
        }
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        const message = err?.message || `Supabase Realtime ${status.toLowerCase().replace("_", " ")}`;
        if (!settled) {
          settled = true;
          void client.removeAllChannels();
          reject(new Error(message));
        } else {
          emit({ type: "error", message });
        }
      }
    });
  });

  return () => {
    void client.removeAllChannels();
  };
}
