import type {
  MongoClient as MongoClientType,
  ObjectId as ObjectIdType,
} from "mongodb";
import vm from "node:vm";
import { getMongoDatabaseFromConnectionString } from "./connection-type";

let MongoClient: any, ObjectId: any;
try {
  const mongodb = require("mongodb");
  MongoClient = mongodb.MongoClient;
  ObjectId = mongodb.ObjectId;
} catch (e: any) {
  throw new Error(
    `Failed to load the "mongodb" module. Is the "mongodb" npm package installed? ${e?.message || ""}`
  );
}

import type { QueryResult } from "./client-types";
import { serializeValue as _serializeValue } from "./serialize-value";
export type { QueryResult };

type MongoCommand = {
  database?: string;
  collection?: string;
  targetCollection?: string;
  operation?: string;
  filter?: Record<string, any>;
  projection?: Record<string, any>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  pipeline?: any[];
  document?: Record<string, any>;
  documents?: Record<string, any>[];
  update?: Record<string, any>;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const SHELL_EVAL_BASE_TIMEOUT_MS = 5_000;
const SHELL_EVAL_MAX_TIMEOUT_MS = 60_000;

// Cache MongoDB clients per connection string to avoid re-creating them per operation
const mongoClientCache = new Map<string, {
  client: MongoClientType;
  lastUsed: number;
}>();

// Cleanup idle MongoDB clients every 10 minutes
setInterval(() => {
  const now = Date.now();
  const MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes
  for (const [key, entry] of mongoClientCache.entries()) {
    if (now - entry.lastUsed > MAX_IDLE_MS) {
      try { entry.client.close().catch(() => {}); } catch {}
      mongoClientCache.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

async function withMongoClient<T>(
  connectionString: string,
  fn: (client: MongoClientType) => Promise<T>,
): Promise<T> {
  const cached = mongoClientCache.get(connectionString);
  if (cached) {
    cached.lastUsed = Date.now();
    try {
      return await fn(cached.client);
    } catch (err: any) {
      // If the error is connection-related, evict the cached client and retry once
      if (err?.message && /(pool destroyed|timed out|closed|topology)/i.test(err.message)) {
        mongoClientCache.delete(connectionString);
        try { cached.client.close().catch(() => {}); } catch {}
        // Fall through to create a new client below
      } else {
        throw err;
      }
    }
  }

  const client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: DEFAULT_TIMEOUT_MS,
    connectTimeoutMS: DEFAULT_TIMEOUT_MS,
    appName: "RexaDB",
  });

  try {
    await client.connect();
    mongoClientCache.set(connectionString, { client, lastUsed: Date.now() });
    return await fn(client);
  } catch (err) {
    // If connection fails, don't cache it
    try { await client.close(); } catch {}
    throw err;
  }
}

function toObjectIdIfNeeded(value: any) {
  if (
    typeof value === "string" &&
    ObjectId.isValid(value) &&
    value.length === 24
  ) {
    return new ObjectId(value);
  }
  return value;
}

function normalizeFilter(filter: Record<string, any> = {}) {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === "_id") {
      normalized[key] = toObjectIdIfNeeded(value);
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function serializeValue(value: any): any {
  return _serializeValue(value, (v) =>
    v instanceof ObjectId ? v.toString() : undefined,
  );
}

function inferFields(rows: any[]) {
  const names = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    Object.keys(row).forEach((k) => names.add(k));
  }
  return Array.from(names).map((name) => ({
    name,
    dataTypeID: 0,
    dataTypeName: "mixed",
  }));
}

function parseMongoCommand(input: string): MongoCommand {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return { operation: "listCollections" };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Mongo command JSON must be an object.");
    }
    return parsed as MongoCommand;
  } catch (error: any) {
    const shellParsed = parseMongoShellCommand(trimmed);
    if (shellParsed) return shellParsed;
    throw new Error(
      `Invalid Mongo query. Use JSON command or shell syntax like db.users.find({}).limit(100). ${error?.message || ""}`.trim(),
    );
  }
}

function splitTopLevelArgs(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBrace = 0;

  let depthBracket = 0;
  let quote: "'" | '"' | "`" | null = null;
  // fallow-ignore-next-line code-duplication
  let escape = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escape = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch as "'" | '"' | "`";
      current += ch;
      continue;
    }
    if (ch === "(") depthParen += 1;
    if (ch === ")") depthParen -= 1;
    if (ch === "{") depthBrace += 1;
    if (ch === "}") depthBrace -= 1;
    if (ch === "[") depthBracket += 1;
    if (ch === "]") depthBracket -= 1;
    if (
      ch === "," &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0
    ) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

function evalShellLiteral(expr: string): any {
  const source = String(expr || "").trim();
  if (!source) return undefined;

  // Try JSON.parse first — handles objects, arrays, strings, numbers, booleans, null
  try {
    return JSON.parse(source);
  } catch {}

  // Handle simple literals without using vm
  if (source === "null") return null;
  if (source === "true") return true;
  if (source === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(source)) return Number(source);

  // Handle quoted strings
  if (
    (source.startsWith("'") && source.endsWith("'")) ||
    (source.startsWith('"') && source.endsWith('"'))
  ) {
    return source.slice(1, -1);
  }

  // Handle ObjectId('...')
  const oidMatch = source.match(/^ObjectId\(['"]([a-f0-9]{24})['"]\)$/i);
  if (oidMatch) return new ObjectId(oidMatch[1]);

  // Handle new Date(...) or ISODate(...)
  const dateMatch = source.match(/^(?:new\s+Date|ISODate)\(['"](.+)['"]\)$/i);
  if (dateMatch) return new Date(dateMatch[1]);
  const numDateMatch = source.match(/^(?:new\s+Date|ISODate)\((\d+)\)$/i);
  if (numDateMatch) return new Date(Number(numDateMatch[1]));

  // For anything else, return the raw string (safe fallback instead of code execution)
  return source;
}

function findBalancedParenEnd(input: string, start: number): number {
  let depth = 1;
  let idx = start;
  let quote: "'" | '"' | "`" | null = null;
  let escape = false;
  for (; idx < input.length; idx += 1) {
    const ch = input[idx];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch as "'" | '"' | "`";
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return depth === 0 ? idx : -1;
}

function parseHeadCall(input: string) {
  const prefixMatch = input.match(/^db\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)\(/);
  if (!prefixMatch) return null;
  const collection = prefixMatch[1];
  const method = prefixMatch[2];
  const start = prefixMatch[0].length;

  const idx = findBalancedParenEnd(input, start);
  if (idx === -1) return null;
  const argsRaw = input.slice(start, idx).trim();
  const rest = input.slice(idx + 1).trim();
  return { collection, method, argsRaw, rest };
}

function parseChainModifiers(rest: string): Record<string, any> {
  let s = rest.trim();
  const out: Record<string, any> = {};
  while (s.startsWith(".")) {
    const methodMatch = s.match(/^\.([A-Za-z0-9_]+)\(/);
    if (!methodMatch) break;
    const method = methodMatch[1].toLowerCase();
    const openLen = methodMatch[0].length;
    const i = findBalancedParenEnd(s, openLen);
    if (i === -1) break;
    const argsRaw = s.slice(openLen, i).trim();
    const args = splitTopLevelArgs(argsRaw).map(evalShellLiteral);
    if (method === "sort") out.sort = args[0] || {};
    if (method === "limit") out.limit = Number(args[0] ?? 0);
    if (method === "skip") out.skip = Number(args[0] ?? 0);
    s = s.slice(i + 1).trim();
  }
  return out;
}

function parseMongoShellCommand(input: string): MongoCommand | null {
  const trimmed = String(input || "")
    .trim()
    .replace(/;$/, "")
    .trim();
  if (!trimmed) return null;
  if (/^show\s+dbs?$/i.test(trimmed)) return { operation: "listDatabases" };
  if (/^show\s+collections?$/i.test(trimmed))
    return { operation: "listCollections" };
  if (/^use\s+[\w-]+$/i.test(trimmed)) return { operation: "listCollections" };

  const head = parseHeadCall(trimmed);
  if (!head) return null;

  const { collection, method, argsRaw, rest } = head;
  const methodLower = method.toLowerCase();
  const args = splitTopLevelArgs(argsRaw).map(evalShellLiteral);
  const chain = parseChainModifiers(rest);

  if (methodLower === "find") {
    return {
      collection,
      operation: "find",
      filter: (args[0] as Record<string, any>) || {},
      projection: (args[1] as Record<string, any>) || undefined,
      ...chain,
    };
  }
  if (methodLower === "findone") {
    return {
      collection,
      operation: "findOne",
      filter: (args[0] as Record<string, any>) || {},
      projection: (args[1] as Record<string, any>) || undefined,
    };
  }
  if (methodLower === "aggregate") {
    return {
      collection,
      operation: "aggregate",
      pipeline: (Array.isArray(args[0]) ? args[0] : []) as any[],
      ...chain,
    };
  }
  if (methodLower === "count" || methodLower === "countdocuments") {
    return {
      collection,
      operation: "count",
      filter: (args[0] as Record<string, any>) || {},
    };
  }
  if (methodLower === "insertone") {
    return {
      collection,
      operation: "insertOne",
      document: (args[0] as Record<string, any>) || {},
    };
  }
  if (methodLower === "insertmany") {
    const documents = Array.isArray(args[0])
      ? (args[0] as Record<string, any>[])
      : [];
    return {
      collection,
      operation: "insertMany",
      documents,
    };
  }
  if (methodLower === "updateone" || methodLower === "updatemany") {
    return {
      collection,
      operation: methodLower === "updateone" ? "updateOne" : "updateMany",
      filter: (args[0] as Record<string, any>) || {},
      update: (args[1] as Record<string, any>) || {},
    };
  }
  if (methodLower === "deleteone" || methodLower === "deletemany") {
    return {
      collection,
      operation: methodLower === "deleteone" ? "deleteOne" : "deleteMany",
      filter: (args[0] as Record<string, any>) || {},
    };
  }

  return null;
}

export async function testMongoConnection(connectionString: string) {
  await withMongoClient(connectionString, async (client) => {
    await client.db("admin").command({ ping: 1 });
  });
}

export async function executeMongoQuery(
  connectionString: string,
  query: string,
): Promise<QueryResult> {
  const command = parseMongoCommand(query);
  const defaultDb = getMongoDatabaseFromConnectionString(connectionString);
  const targetDb = command.database || defaultDb;

  return withMongoClient(connectionString, async (client) => {
    const db = client.db(targetDb);
    const operation = String(command.operation || "find").toLowerCase();

    if (operation === "listdatabases") {
      const admin = client.db("admin");
      const res = await admin.admin().listDatabases();
      const rows = (res.databases || []).map((d: any) =>
        serializeValue({
          name: d.name,
          sizeOnDisk: d.sizeOnDisk,
          empty: d.empty,
        }),
      );
      return { rows, fields: inferFields(rows), rowCount: rows.length };
    }

    if (operation === "listcollections") {
      const rows = (
        await db.listCollections({}, { nameOnly: true }).toArray()
      ).map((c: any) => serializeValue({ name: c.name }));
      return { rows, fields: inferFields(rows), rowCount: rows.length };
    }

    if (!command.collection) {
      throw new Error(
        "Mongo command requires `collection` for this operation.",
      );
    }

    const collection = db.collection(command.collection);
    const filter = normalizeFilter(command.filter || {});
    const limit =
      typeof command.limit === "number"
        ? Math.max(0, Math.min(command.limit, 5000))
        : 100;
    const skip =
      typeof command.skip === "number" ? Math.max(0, command.skip) : 0;

    if (operation === "count") {
      const count = await collection.countDocuments(filter);
      const rows = [{ count }];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    if (operation === "findone") {
      const doc = await collection.findOne(filter, {
        projection: command.projection || undefined,
      });
      const rows = doc ? [serializeValue(doc)] : [];
      return { rows, fields: inferFields(rows), rowCount: rows.length };
    }

    if (operation === "find") {
      const docs = await collection
        .find(filter, { projection: command.projection || undefined })

        .sort(command.sort || {})
        .skip(skip)
        .limit(limit)
        .toArray();
      const rows = docs.map((d: any) => serializeValue(d));
      return { rows, fields: inferFields(rows), rowCount: rows.length };
    }

    // fallow-ignore-next-line code-duplication
    if (operation === "aggregate") {
      const pipeline = Array.isArray(command.pipeline) ? command.pipeline : [];
      const docs = await collection.aggregate(pipeline).limit(limit).toArray();
      const rows = docs.map((d: any) => serializeValue(d));
      return { rows, fields: inferFields(rows), rowCount: rows.length };
    }

    if (operation === "insertone") {
      const document = command.document || {};
      const res = await collection.insertOne(document);
      const rows = [
        {
          acknowledged: res.acknowledged,
          insertedId: serializeValue(res.insertedId),
        },
      ];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    if (operation === "insertmany") {
      const documents = Array.isArray(command.documents)
        ? command.documents
        : [];
      const res = await collection.insertMany(documents);
      const rows = [
        { acknowledged: res.acknowledged, insertedCount: res.insertedCount },
      ];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    if (operation === "createcollection") {
      await db.createCollection(command.collection);
      const rows = [{ acknowledged: true, collection: command.collection }];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    if (operation === "dropcollection") {
      const dropped = await db
        .collection(command.collection)
        .drop()
        .catch((error: any) => {
          if (
            String(error?.message || "")
              .toLowerCase()
              .includes("ns not found")
          )
            return false;
          throw error;
        });
      const rows = [
        {
          acknowledged: true,
          dropped: !!dropped,
          collection: command.collection,
        },
      ];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    if (operation === "clonecollection") {
      const targetCollection = String(command.targetCollection || "").trim();
      if (!targetCollection) {
        throw new Error("Mongo cloneCollection requires `targetCollection`.");
      }
      await collection
        .aggregate([{ $match: {} }, { $out: targetCollection }])
        .toArray();
      const rows = [
        {
          acknowledged: true,
          source: command.collection,
          target: targetCollection,
        },
      ];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    if (operation === "updateone" || operation === "updatemany") {
      const update = command.update || {};
      if (
        !update ||
        typeof update !== "object" ||
        Object.keys(update).length === 0
      ) {
        throw new Error(
          "Mongo update operations require a non-empty `update` object.",
        );
      }
      const res =
        operation === "updateone"
          ? await collection.updateOne(filter, update)
          : await collection.updateMany(filter, update);
      const rows = [
        {
          acknowledged: res.acknowledged,
          matchedCount: res.matchedCount,
          modifiedCount: res.modifiedCount,
        },
      ];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    if (operation === "deleteone" || operation === "deletemany") {
      const res =
        operation === "deleteone"
          ? await collection.deleteOne(filter)
          : await collection.deleteMany(filter);
      const rows = [
        { acknowledged: res.acknowledged, deletedCount: res.deletedCount },
      ];
      return { rows, fields: inferFields(rows), rowCount: 1 };
    }

    throw new Error(`Unsupported Mongo operation: ${operation}`);
  });
}

export async function getMongoDatabases(connectionString: string): Promise<string[]> {
  return withMongoClient(connectionString, async (client) => {
    const res = await client.db("admin").admin().listDatabases();
    return (res.databases || []).map((d: any) => String(d.name));
  });
}

export async function getMongoCollections(
  connectionString: string,
  database?: string,
): Promise<string[]> {
  const dbName =
    database || getMongoDatabaseFromConnectionString(connectionString);
  return withMongoClient(connectionString, async (client) => {
    const cols = await client
      .db(dbName)
      .listCollections({}, { nameOnly: true })
      .toArray();
    return cols
      .map((c: any) => c.name)
      .sort((a: string, b: string) => a.localeCompare(b));
  });
}

export async function getMongoCollectionStructure(
  connectionString: string,
  database: string,
  collectionName: string,
) {
  const SAMPLE_SIZE = 100;
  return withMongoClient(connectionString, async (client) => {
    const collection = client.db(database).collection(collectionName);
    const docs = await collection.find({}, { limit: SAMPLE_SIZE }).toArray();

    const typeMap = new Map<string, Set<string>>();
    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        const types = typeMap.get(key) || new Set<string>();
        if (value === null) types.add("null");
        else if (value instanceof ObjectId) types.add("objectId");
        else if (value instanceof Date) types.add("date");
        else if (Array.isArray(value)) types.add("array");
        else types.add(typeof value);
        typeMap.set(key, types);
      }
    }

    const fields = Array.from(typeMap.entries()).map(([columnName, types]) => ({
      column_name: columnName,
      data_type: Array.from(types).join("|"),
      is_nullable: types.has("null") ? "YES" : "NO",
      column_default: columnName === "_id" ? "ObjectId()" : null,
      is_primary_key: columnName === "_id",
      is_foreign_key: false,
    }));

    if (!fields.find((f) => f.column_name === "_id")) {
      fields.unshift({
        column_name: "_id",
        data_type: "objectId",
        is_nullable: "NO",
        column_default: "ObjectId()",
        is_primary_key: true,
        is_foreign_key: false,
      });
    }

    return fields;
  });
}

export async function updateMongoRows(
  connectionString: string,
  database: string,
  collectionName: string,
  updates: Array<{ where: Record<string, any>; set: Record<string, any> }>,
) {
  return withMongoClient(connectionString, async (client) => {
    const collection = client.db(database).collection(collectionName);
    for (const update of updates) {
      const where = normalizeFilter(update.where || {});
      await collection.updateMany(where, { $set: update.set || {} });
    }
    return { success: true };
  });
}

export async function deleteMongoRows(
  connectionString: string,
  database: string,
  collectionName: string,
  whereClauses: Array<Record<string, any>>,
) {
  return withMongoClient(connectionString, async (client) => {
    const collection = client.db(database).collection(collectionName);
    for (const where of whereClauses) {
      await collection.deleteMany(normalizeFilter(where || {}));
    }
    return { success: true };
  });
}

export async function createMongoDatabase(
  connectionString: string,
  dbName: string,
) {
  return withMongoClient(connectionString, async (client) => {
    const db = client.db(dbName);
    const tempCollection = "__rexadb_init__";
    await db.createCollection(tempCollection);
    await db
      .collection(tempCollection)
      .insertOne({ createdAt: new Date().toISOString() });
    return { success: true };
  });
}

async function createMongoCollection(
  connectionString: string,
  dbName: string,
  collectionName: string,
) {
  return withMongoClient(connectionString, async (client) => {
    await client.db(dbName).createCollection(collectionName);
    return { success: true };
  });
}
