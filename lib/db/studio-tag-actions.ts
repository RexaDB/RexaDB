import { ensureConnectionExists, ensureCoreTables } from "./ensure-core-tables";
import { formatDbError, runCoreTransaction } from "./sqlite-helpers";

type StudioTag = { name: string; color: string };
type TableTagChange = {
  tableName: string;
  tags: string[];
  operation?: "replace" | "add" | "remove";
};

function normalizeName(value: unknown) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 64) throw new Error("Tag names must contain 1–64 characters.");
  return name;
}

function normalizeColor(value: unknown) {
  const color = String(value ?? "").trim();
  if (!/^#[\da-f]{3}(?:[\da-f]{3}|[\da-f]{5})?$/i.test(color)) {
    throw new Error("Tag colors must be 3, 6, or 8 digit hex values.");
  }
  return color;
}

async function withTagTransaction<T>(
  connectionId: number,
  label: string,
  operation: (db: typeof import("./index").db, tags: typeof import("./schema").tags, tableTags: typeof import("./schema").tableTags) => Promise<T>,
) {
  await ensureCoreTables();
  await ensureConnectionExists(connectionId);
  const schema = await import("./schema");
  try {
    const data = await runCoreTransaction(label, async (db) =>
      operation(db, schema.tags, schema.tableTags),
    );
    return { success: true, data };
  } catch (error) {
    console.error(`[rexadb] ${label}:error`, { connectionId, error: formatDbError(error) });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Create multiple tags in one serialized transaction; duplicates are reported, not destructive. */
export async function createStudioTags(connectionId: number, inputs: StudioTag[]) {
  return withTagTransaction(connectionId, "createStudioTags", async (db, tags) => {
    const { eq } = await import("drizzle-orm");
    const existing = await db.select().from(tags).where(eq(tags.connectionId, connectionId));
    const names = new Set(existing.map((tag) => tag.name.toLowerCase()));
    const created: StudioTag[] = [];
    const alreadyExisted: string[] = [];
    for (const input of inputs) {
      const name = normalizeName(input.name);
      if (names.has(name.toLowerCase())) {
        alreadyExisted.push(name);
        continue;
      }
      const tag = { name, color: normalizeColor(input.color) };
      created.push(tag);
      names.add(name.toLowerCase());
    }
    if (created.length) {
      await db.insert(tags).values(created.map((tag) => ({ ...tag, connectionId })));
    }
    return { created, alreadyExisted };
  });
}

/** Rename/recolor or merge a tag without replacing unrelated connection tags. */
export async function updateStudioTag(
  connectionId: number,
  input: { name: string; newName?: string; color?: string },
) {
  return withTagTransaction(connectionId, "updateStudioTag", async (db, tags, tableTags) => {
    const { and, eq, inArray } = await import("drizzle-orm");
    const allTags = await db.select().from(tags).where(eq(tags.connectionId, connectionId));
    const current = allTags.find((tag) => tag.name === input.name);
    if (!current) throw new Error(`Tag "${input.name}" was not found.`);
    const requestedName = input.newName ? normalizeName(input.newName) : current.name;
    const target = allTags.find((tag) =>
      tag.id !== current.id && tag.name.toLowerCase() === requestedName.toLowerCase(),
    );
    const finalName = target?.name ?? requestedName;
    const color = input.color ? normalizeColor(input.color) : current.color;

    if (target) {
      if (input.color) await db.update(tags).set({ color }).where(eq(tags.id, target.id));
      const oldAssignments = await db.select().from(tableTags).where(and(
        eq(tableTags.connectionId, connectionId),
        eq(tableTags.tagName, current.name),
      ));
      const targetAssignments = await db.select({ tableName: tableTags.tableName })
        .from(tableTags).where(and(
          eq(tableTags.connectionId, connectionId),
          eq(tableTags.tagName, target.name),
        ));
      const targetTables = new Set(targetAssignments.map((row) => row.tableName));
      const duplicates = oldAssignments.filter((row) => targetTables.has(row.tableName));
      const movable = oldAssignments.filter((row) => !targetTables.has(row.tableName));
      if (duplicates.length) {
        await db.delete(tableTags).where(inArray(tableTags.id, duplicates.map((row) => row.id)));
      }
      for (const row of movable) {
        await db.update(tableTags).set({ tagName: finalName }).where(eq(tableTags.id, row.id));
      }
      await db.delete(tags).where(eq(tags.id, current.id));
    } else {
      await db.update(tags).set({ name: finalName, color }).where(eq(tags.id, current.id));
    }
    return { name: finalName, color, merged: Boolean(target) };
  });
}

/** Delete a tag and its assignments transactionally. */
export async function deleteStudioTag(connectionId: number, name: string) {
  return withTagTransaction(connectionId, "deleteStudioTag", async (db, tags, tableTags) => {
    const { and, eq } = await import("drizzle-orm");
    const existing = await db.select({ id: tags.id }).from(tags).where(and(
      eq(tags.connectionId, connectionId), eq(tags.name, name),
    ));
    if (!existing.length) throw new Error(`Tag "${name}" was not found.`);
    await db.delete(tableTags).where(and(
      eq(tableTags.connectionId, connectionId), eq(tableTags.tagName, name),
    ));
    await db.delete(tags).where(and(eq(tags.connectionId, connectionId), eq(tags.name, name)));
    return { deleted: name };
  });
}

/** Apply one or many table-tag edits atomically, avoiding stale whole-map overwrites. */
export async function applyStudioTableTagChanges(
  connectionId: number,
  changes: TableTagChange[],
  tagsToCreate: StudioTag[] = [],
) {
  return withTagTransaction(connectionId, "applyStudioTableTagChanges", async (db, tags, tableTags) => {
    const { and, eq, inArray } = await import("drizzle-orm");
    const tableNames = [...new Set(changes.map((change) => String(change.tableName || "").trim()))];
    if (tableNames.some((name) => !name)) throw new Error("Every assignment needs a table name.");
    const knownTags = await db.select({ name: tags.name }).from(tags).where(eq(tags.connectionId, connectionId));
    const allowed = new Map(knownTags.map((tag) => [tag.name.toLowerCase(), tag.name]));
    const createdTags: StudioTag[] = [];
    for (const tag of tagsToCreate) {
      const name = normalizeName(tag.name);
      if (allowed.has(name.toLowerCase())) continue;
      const color = normalizeColor(tag.color);
      await db.insert(tags).values({ connectionId, name, color });
      allowed.set(name.toLowerCase(), name);
      createdTags.push({ name, color });
    }
    for (const change of changes) {
      const missing = change.tags.filter((name) => !allowed.has(name.toLowerCase()));
      if (missing.length) throw new Error(`Unknown tag(s): ${missing.join(", ")}. Create them first.`);
    }

    const currentRows = tableNames.length
      ? await db.select().from(tableTags).where(and(
          eq(tableTags.connectionId, connectionId), inArray(tableTags.tableName, tableNames),
        ))
      : [];
    const byTable = new Map<string, string[]>();
    for (const row of currentRows) byTable.set(row.tableName, [...(byTable.get(row.tableName) || []), row.tagName]);
    for (const change of changes) {
      const tableName = String(change.tableName).trim();
      const current = byTable.get(tableName) || [];
      const canonicalTags = change.tags.map((name) => allowed.get(name.toLowerCase())!);
      const next = change.operation === "add"
        ? [...new Set([...current, ...canonicalTags])]
        : change.operation === "remove"
          ? current.filter((name) => !canonicalTags.includes(name))
          : [...new Set(canonicalTags)];
      byTable.set(tableName, next);
    }

    for (const [tableName, next] of byTable) {
      await db.delete(tableTags).where(and(
        eq(tableTags.connectionId, connectionId), eq(tableTags.tableName, tableName),
      ));
      if (next.length) {
        await db.insert(tableTags).values(next.map((tagName) => ({ connectionId, tableName, tagName })));
      }
    }
    return {
      createdTags,
      updated: [...byTable].map(([tableName, names]) => ({ tableName, tags: names })),
    };
  });
}
