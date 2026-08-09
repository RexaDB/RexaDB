import { SQLITE_BUSY_RETRY_ATTEMPTS, SQLITE_BUSY_BASE_DELAY_MS, delay } from "./actions-constants";

export function isSqliteBusyError(error: any) {
  const message = String(error?.message ?? error?.cause?.message ?? "").toLowerCase();
  const codes = [
    error?.code,
    error?.cause?.code,
    error?.extendedCode,
    error?.cause?.extendedCode,
    error?.rawCode,
    error?.cause?.rawCode,
  ].map((code) => String(code ?? ""));

  return message.includes("database is locked")
    || codes.includes("SQLITE_BUSY")
    || codes.includes("5");
}

export function formatDbError(error: any): string {
  const parts: string[] = [];
  const message = error?.message ?? error?.cause?.message;
  if (message) parts.push(String(message));
  const code = error?.code ?? error?.cause?.code;
  if (code) parts.push(`code=${code}`);
  const rawCode = error?.rawCode ?? error?.cause?.rawCode;
  if (rawCode) parts.push(`rawCode=${rawCode}`);
  return parts.length > 0 ? parts.join(" | ") : "Unknown database error";
}

export function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export async function withSqliteBusyRetry<T>(operation: () => Promise<T> | T, label: string): Promise<T> {
  for (let attempt = 0; attempt < SQLITE_BUSY_RETRY_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt === SQLITE_BUSY_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      const backoffMs = SQLITE_BUSY_BASE_DELAY_MS * (attempt + 1);
      console.warn(`${label}: SQLITE_BUSY retry ${attempt + 1}/${SQLITE_BUSY_RETRY_ATTEMPTS - 1} in ${backoffMs}ms`);
      await delay(backoffMs);
    }
  }

  throw new Error(`${label}: unreachable SQLITE_BUSY retry state`);
}

const txnQueue: Array<() => void> = [];
let txnRunning = false;

async function acquireTxnLock(): Promise<void> {
  if (!txnRunning) {
    txnRunning = true;
    return;
  }
  return new Promise((resolve) => {
    txnQueue.push(resolve);
  });
}

function releaseTxnLock(): void {
  const next = txnQueue.shift();
  if (next) {
    next();
  } else {
    txnRunning = false;
  }
}

export async function runCoreTransaction<T>(
  label: string,
  operation: (db: typeof import("./index").db) => Promise<T>
): Promise<T> {
  await acquireTxnLock();
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    return await withSqliteBusyRetry(async () => {
      await db.run(sql.raw("BEGIN"));
      try {
        const result = await operation(db);
        await db.run(sql.raw("COMMIT"));
        return result;
      } catch (error) {
        try { await db.run(sql.raw("ROLLBACK")); } catch {} 
        throw error;
      }
    }, label);
  } finally {
    releaseTxnLock();
  }
}
