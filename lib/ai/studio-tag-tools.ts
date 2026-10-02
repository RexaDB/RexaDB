import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "@/tools/types";
import { getStudioTags, getStudioTableTags } from "@/lib/db/actions-core";
import {
  applyStudioTableTagChanges,
  createStudioTags,
  deleteStudioTag,
  updateStudioTag,
} from "@/lib/db/studio-tag-actions";
import { createStudioTagBatchTools } from "@/lib/ai/studio-tag-batch-tools";

export type StudioTagToolContext = {
  connectionId?: number | null;
  defaultNamespace?: string;
  emitStep: (message: string) => void;
  notifyStudioTagsChanged?: () => void;
};

const TAG_COLORS = [
  "#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#94a3b8",
];

function requireConnectionId(context: StudioTagToolContext) {
  if (!Number.isInteger(context.connectionId) || Number(context.connectionId) < 1) {
    throw new Error("Tag management requires an active saved connection.");
  }
  return Number(context.connectionId);
}

function validName(value: string) {
  const name = String(value || "").trim();
  if (!name || name.length > 64) {
    throw new Error("Tag names must contain between 1 and 64 characters.");
  }
  return name;
}

function validColor(value: string) {
  const color = String(value || "").trim();
  if (!/^#[\da-f]{3}(?:[\da-f]{3}|[\da-f]{5})?$/i.test(color)) {
    throw new Error("Tag colors must be 3, 6, or 8 digit hex values.");
  }
  return color;
}

async function readTags(connectionId: number) {
  const result = await getStudioTags(connectionId);
  if (!result.success) throw new Error(result.error || "Could not load tags.");
  return (result.data || []).map((tag: any) => ({
    name: String(tag.name),
    color: String(tag.color),
  }));
}

async function readTableTags(connectionId: number) {
  const result = await getStudioTableTags(connectionId);
  if (!result.success) throw new Error(result.error || "Could not load table tags.");
  return (result.data || {}) as Record<string, string[]>;
}

function requireSuccess<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (!result.success) throw new Error(result.error || "Tag operation failed.");
  return result.data as T;
}

function makeTool(
  context: StudioTagToolContext,
  spec: {
    name: string;
    label: string;
    description: string;
    promptSnippet: string;
    parameters: ReturnType<typeof Type.Object>;
    run: (params: any) => Promise<unknown>;
  },
): ToolDefinition {
  return defineTool({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    parameters: spec.parameters,
    execute: async (_toolCallId, params) => {
      try {
        context.emitStep(spec.label);
        const data = await spec.run(params);
        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
          details: (data ?? null) as JsonValue,
        };
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
    },
  });
}

/** Tools operate on RexaDB's local per-connection table-organizing metadata, not DB rows. */
export function createStudioTagTools(context: StudioTagToolContext): ToolDefinition[] {
  if (!Number.isInteger(context.connectionId) || Number(context.connectionId) < 1) return [];
  const tagName = Type.String({ description: "Exact existing tag name" });

  return [
    ...createStudioTagBatchTools(context),
    makeTool(context, {
      name: "list_studio_tags",
      label: "List Studio tags",
      description: "List this connection's RexaDB table tags and the tables assigned to each. These are local Studio organization labels, not database data.",
      promptSnippet: "list_studio_tags - inspect RexaDB tags and table assignments for the current connection",
      parameters: Type.Object({}),
      run: async () => {
        const id = requireConnectionId(context);
        const [tags, tableTags] = await Promise.all([readTags(id), readTableTags(id)]);
        return {
          tags: tags.map((tag) => ({
            ...tag,
            tables: Object.entries(tableTags)
              .filter(([, names]) => names.includes(tag.name))
              .map(([table]) => table),
          })),
          assignments: tableTags,
        };
      },
    }),
    makeTool(context, {
      name: "create_studio_tag",
      label: "Create Studio tag",
      description: "Create a RexaDB table-organization tag for this connection. This changes only local Studio metadata, never the database schema or rows.",
      promptSnippet: "create_studio_tag - create a local RexaDB table tag with an optional hex color",
      parameters: Type.Object({
        name: Type.String({ description: "New tag name, up to 64 characters" }),
        color: Type.Optional(Type.String({ description: "Optional 3, 6, or 8 digit hex color" })),
      }),
      run: async ({ name, color }: { name: string; color?: string }) => {
        const id = requireConnectionId(context);
        const normalized = validName(name);
        const tag = { name: normalized, color: color ? validColor(color) : TAG_COLORS[0] };
        const result = requireSuccess(await createStudioTags(id, [tag]));
        if (result.created.length) context.notifyStudioTagsChanged?.();
        return result;
      },
    }),
    makeTool(context, {
      name: "update_studio_tag",
      label: "Update Studio tag",
      description: "Rename a RexaDB table tag and/or change its color. Renaming to an existing tag merges its table assignments.",
      promptSnippet: "update_studio_tag - rename a tag and/or change its color",
      parameters: Type.Object({
        name: tagName,
        newName: Type.Optional(Type.String({ description: "New tag name" })),
        color: Type.Optional(Type.String({ description: "New 3, 6, or 8 digit hex color" })),
      }),
      run: async ({ name, newName, color }: { name: string; newName?: string; color?: string }) => {
        const id = requireConnectionId(context);
        const result = requireSuccess(await updateStudioTag(id, {
          name,
          newName: newName ? validName(newName) : undefined,
          color: color ? validColor(color) : undefined,
        }));
        context.notifyStudioTagsChanged?.();
        return { updated: result };
      },
    }),
    makeTool(context, {
      name: "delete_studio_tag",
      label: "Delete Studio tag",
      description: "Delete a RexaDB table tag and remove it from all table assignments. This only changes local Studio metadata.",
      promptSnippet: "delete_studio_tag - remove a tag and all its table assignments",
      parameters: Type.Object({ name: tagName }),
      run: async ({ name }: { name: string }) => {
        const id = requireConnectionId(context);
        const result = requireSuccess(await deleteStudioTag(id, name));
        context.notifyStudioTagsChanged?.();
        return result;
      },
    }),
    makeTool(context, {
      name: "set_table_tags",
      label: "Set table tags",
      description: "Set, add, or remove RexaDB organization tags on a table. Identify the table as schema.table or pass schema separately. This does not write to the database.",
      promptSnippet: "set_table_tags - replace/add/remove a table's local RexaDB organization tags",
      parameters: Type.Object({
        table: Type.String({ description: "Table name, or schema.table" }),
        schema: Type.Optional(Type.String({ description: "Schema name when table is not schema-qualified" })),
        tags: Type.Array(Type.String(), { description: "Tag names to replace/add/remove" }),
        operation: Type.Optional(Type.Union([
          Type.Literal("replace"), Type.Literal("add"), Type.Literal("remove"),
        ], { description: "Defaults to replace" })),
      }),
      run: async ({ table, schema, tags, operation }: {
        table: string; schema?: string; tags: string[]; operation?: "replace" | "add" | "remove";
      }) => {
        const id = requireConnectionId(context);
        const rawTable = String(table || "").trim();
        if (!rawTable) throw new Error("Table name is required.");
        const effectiveSchema = schema || context.defaultNamespace;
        const tableKey = rawTable.includes(".") || !effectiveSchema
          ? rawTable
          : `${effectiveSchema}.${rawTable}`;
        const result = requireSuccess(await applyStudioTableTagChanges(id, [{
          tableName: tableKey,
          tags,
          operation: operation || "replace",
        }]));
        context.notifyStudioTagsChanged?.();
        return result.updated[0];
      },
    }),
  ];
}
