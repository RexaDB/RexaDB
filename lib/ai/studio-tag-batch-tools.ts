import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "@/tools/types";
import type { StudioTagToolContext } from "@/lib/ai/studio-tag-tools";
import { applyStudioTableTagChanges, createStudioTags } from "@/lib/db/studio-tag-actions";

const COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#94a3b8"];

function asResult<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (!result.success) throw new Error(result.error || "Tag operation failed.");
  return result.data as T;
}

function tableKey(table: string, schema?: string, fallback?: string) {
  const name = String(table || "").trim();
  if (!name) throw new Error("Table name is required.");
  const namespace = schema || fallback;
  return name.includes(".") || !namespace ? name : `${namespace}.${name}`;
}

function defineBatchTool(
  context: StudioTagToolContext,
  spec: { name: string; label: string; description: string; promptSnippet: string; parameters: any; run: (params: any) => Promise<unknown> },
): ToolDefinition {
  return defineTool({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    parameters: spec.parameters,
    execute: async (_id, params) => {
      context.emitStep(spec.label);
      const result = await spec.run(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: (result ?? null) as JsonValue,
      };
    },
  });
}

/** Batch variants reduce tool round trips and commit the whole assignment plan atomically. */
export function createStudioTagBatchTools(context: StudioTagToolContext): ToolDefinition[] {
  if (!Number.isInteger(context.connectionId) || Number(context.connectionId) < 1) return [];
  return [
    defineBatchTool(context, {
      name: "create_studio_tags",
      label: "Create Studio tags",
      description: "Create many local RexaDB table tags in one atomic call. Prefer this for a tag plan; duplicate names are reported as already existing and never erase other tags.",
      promptSnippet: "create_studio_tags - create a batch of local tags at once without overwriting existing tags",
      parameters: Type.Object({
        tags: Type.Array(Type.Object({
          name: Type.String({ description: "Tag name, 1–64 characters" }),
          color: Type.Optional(Type.String({ description: "Optional 3, 6, or 8 digit hex color" })),
        }), { minItems: 1, description: "All tags to ensure exist" }),
      }),
      run: async ({ tags }: { tags: Array<{ name: string; color?: string }> }) => {
        const normalized = tags.map((tag, index) => ({
          name: String(tag.name || "").trim(),
          color: tag.color || COLORS[index % COLORS.length],
        }));
        const result = asResult(await createStudioTags(Number(context.connectionId), normalized));
        if (result.created.length) context.notifyStudioTagsChanged?.();
        return result;
      },
    }),
    defineBatchTool(context, {
      name: "set_tags_for_tables",
      label: "Batch assign Studio tags",
      description: "Apply a complete multi-table tag plan atomically in one call. Optionally create any missing tags in the same transaction, then provide one item per table; each item can replace, add, or remove tags. This avoids partial plans and parallel updates overwriting each other. Use table names as schema.table or provide schema.",
      promptSnippet: "set_tags_for_tables - atomically apply tags across many tables in one batch",
      parameters: Type.Object({
        createTags: Type.Optional(Type.Array(Type.Object({
          name: Type.String({ description: "Tag name to create if not already present" }),
          color: Type.Optional(Type.String({ description: "Optional 3, 6, or 8 digit hex color" })),
        }), { description: "Tags to create in the same transaction before assignments" })),
        assignments: Type.Array(Type.Object({
          table: Type.String({ description: "Table name, optionally schema-qualified" }),
          schema: Type.Optional(Type.String({ description: "Schema when table is not qualified" })),
          tags: Type.Array(Type.String(), { description: "Exact existing tag names" }),
          operation: Type.Optional(Type.Union([
            Type.Literal("replace"), Type.Literal("add"), Type.Literal("remove"),
          ])),
        }), { minItems: 1, description: "One or more table assignments" }),
      }),
      run: async ({ assignments, createTags = [] }: { createTags?: Array<{ name: string; color?: string }>; assignments: Array<{
        table: string; schema?: string; tags: string[]; operation?: "replace" | "add" | "remove";
      }> }) => {
        const changes = assignments.map((item) => ({
          tableName: tableKey(item.table, item.schema, context.defaultNamespace),
          tags: item.tags,
          operation: item.operation || "replace",
        }));
        const tagsToCreate = createTags.map((tag, index) => ({
          name: tag.name,
          color: tag.color || COLORS[index % COLORS.length],
        }));
        const result = asResult(await applyStudioTableTagChanges(
          Number(context.connectionId), changes, tagsToCreate,
        ));
        if (result.createdTags.length || changes.length) context.notifyStudioTagsChanged?.();
        return {
          createdTags: result.createdTags,
          updatedCount: result.updated.length,
          assignments: result.updated,
        };
      },
    }),
  ];
}
