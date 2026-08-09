import {
  buildRedisDatabaseList,
  normalizeRedisConnectionString,
  updateRedisConnectionStringDatabase,
} from "./redis-utils";
import { createTokenizer } from "@/lib/shared/split-args";
import type { RedisKeyInfo } from "@/types/redis";

// NOTE: Do NOT require('redis') at module top-level.
// In the packaged Electron app the ASAR path resolution differs from dev and
// a top-level require can silently resolve to `undefined`, causing the cryptic
// "t is not a function" error when createClient() is called later.
// Instead we require lazily inside withRedisClient at call-time.

import type { QueryResult } from "./client-types";

async function withRedisClient<T>(
  connectionString: string,
  fn: (client: any) => Promise<T>,
) {
  // Lazy require so the module is resolved at call-time with the correct path,
  // which matters in the packaged Electron app where the ASAR layout differs.
  let resolvedCreateClient: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const redisModule = require("redis");
    // redis v4+ exports createClient as a named export; handle both CJS and ESM interop.
    resolvedCreateClient =
      redisModule.createClient ?? redisModule.default?.createClient;
  } catch (requireErr: any) {
    throw new Error(
      `Failed to load redis module: ${requireErr?.message ?? requireErr}`,
    );
  }

  if (typeof resolvedCreateClient !== "function") {
    throw new Error(
      `redis.createClient is not a function (got ${typeof resolvedCreateClient}). ` +
        `This usually means the redis package failed to load correctly in the packaged app. ` +
        `Ensure 'redis' is listed in asarUnpack in package.json.`,
    );
  }

  const client = resolvedCreateClient({
    url: normalizeRedisConnectionString(connectionString),
    socket: {
      connectTimeout: 15000,
      reconnectStrategy: false,
    },
  });
  client.on("error", (err: any) => console.error("Redis client error:", err));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.quit().catch(() => {});
  }
}

const splitRedisArgs = createTokenizer();

function inferFields(rows: any[]) {
  const names = new Set<string>();
  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    Object.keys(row).forEach((key) => names.add(key));
  });
  return Array.from(names).map((name) => ({
    name,
    dataTypeID: 0,
    dataTypeName: "mixed",
  }));
}

function normalizeRedisValue(value: any): any {
  if (Buffer.isBuffer(value)) return value.toString();
  if (Array.isArray(value))
    return value.map((item) => normalizeRedisValue(item));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    Object.entries(value).forEach(([key, val]) => {
      out[key] = normalizeRedisValue(val);
    });
    return out;
  }
  return value;
}

function toRows(result: any) {
  const normalized = normalizeRedisValue(result);
  if (Array.isArray(normalized)) {
    if (normalized.length === 0) return [];
    if (typeof normalized[0] === "object" && !Array.isArray(normalized[0])) {
      return normalized;
    }
    return normalized.map((item) => ({ value: item }));
  }
  if (normalized && typeof normalized === "object") {
    return [normalized];
  }
  return [{ result: normalized }];
}

function unwrapMultiValue(value: any) {
  if (Array.isArray(value) && value.length === 2 && value[0] instanceof Error)
    return null;
  if (Array.isArray(value) && value.length === 2 && value[0] == null)
    return value[1];
  return value;
}

async function scanKeys(client: any, pattern: string, limit: number) {
  const keys: string[] = [];
  let cursor = "0";
  const match = pattern ? ["MATCH", pattern] : [];
  while (true) {
    const reply = await client.sendCommand([
      "SCAN",
      cursor,
      ...match,
      "COUNT",
      "200",
    ]);
    if (Array.isArray(reply) && reply.length >= 2) {
      cursor = String(reply[0]);
      const batch = Array.isArray(reply[1]) ? reply[1] : [];
      batch.forEach((k) => keys.push(String(k)));
    } else {
      break;
    }
    if (cursor === "0" || keys.length >= limit) break;
  }
  return keys.slice(0, limit);
}

export async function executeRedisCommand(
  connectionString: string,
  commandText: string,
): Promise<QueryResult> {
  const args = splitRedisArgs(commandText);
  if (args.length === 0) return { rows: [], fields: [], rowCount: 0 };
  return withRedisClient(connectionString, async (client) => {
    const result = await client.sendCommand(args);
    const rows = toRows(result);
    return { rows, fields: inferFields(rows), rowCount: rows.length };
  });
}

export async function getRedisDatabases(
  connectionString: string,
): Promise<string[]> {
  return withRedisClient(connectionString, async (client) => {
    try {
      const reply = await client.sendCommand(["CONFIG", "GET", "databases"]);
      if (Array.isArray(reply) && reply.length >= 2) {
        const count = Number.parseInt(String(reply[1] ?? "16"), 10);
        return buildRedisDatabaseList(Number.isFinite(count) ? count : 16);
      }
    } catch {
      // ignore and fallback
    }
    return buildRedisDatabaseList(16);
  });
}

export async function getRedisKeysWithMeta(
  connectionString: string,
  options?: { pattern?: string; limit?: number; db?: string },
) {
  const pattern = String(options?.pattern || "*");
  const limit = Number.isFinite(options?.limit)
    ? Math.max(1, Math.min(options?.limit || 200, 1000))
    : 200;
  const resolvedConn = options?.db
    ? updateRedisConnectionStringDatabase(connectionString, options.db)
    : connectionString;
  return withRedisClient(resolvedConn, async (client) => {
    const keys = await scanKeys(client, pattern, limit);
    if (keys.length === 0) return [] as RedisKeyInfo[];
    const typeMulti = client.multi();
    const ttlMulti = client.multi();
    keys.forEach((key) => {
      typeMulti.type(key);
      ttlMulti.ttl(key);
    });
    const typesRaw = await typeMulti.exec();
    const ttlsRaw = await ttlMulti.exec();
    const types = (typesRaw || []).map((entry: any) =>
      String(unwrapMultiValue(entry) ?? "unknown"),
    );
    const ttls = (ttlsRaw || []).map((entry: any) => {
      const value = Number(unwrapMultiValue(entry));
      if (!Number.isFinite(value)) return null;
      if (value < 0) return null;
      return value;
    });
    const sizes = await Promise.all(
      keys.map(async (key, index) => {
        const type = types[index];
        try {
          if (type === "string")
            return Number(await client.sendCommand(["STRLEN", key]));
          if (type === "list")
            return Number(await client.sendCommand(["LLEN", key]));
          if (type === "set")
            return Number(await client.sendCommand(["SCARD", key]));
          if (type === "zset")
            return Number(await client.sendCommand(["ZCARD", key]));
          if (type === "hash")
            return Number(await client.sendCommand(["HLEN", key]));
          if (type === "stream")
            return Number(await client.sendCommand(["XLEN", key]));
        } catch {
          return null;
        }
        return null;
      }),
    );
    return keys.map((key, index) => ({
      key,
      type: types[index] || "unknown",
      ttlSeconds: ttls[index] ?? null,
      size: sizes[index] ?? null,
    }));
  });
}
