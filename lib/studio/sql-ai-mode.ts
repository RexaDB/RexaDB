import type { LightSchemaContextTable } from "@/lib/ai/types";

type SchemaEntry = {
  schema?: string;
  name?: string;
  columns?: Array<{ name?: string; type?: string }>;
};

export function isSqlAiPrompt(value: string) {
  return /^\s*\/(?:\s|$)/.test(value);
}

export function getSqlAiPrompt(value: string) {
  return value.replace(/^\s*\/\s?/, "").trim();
}

function getTargetLanguage(dbType: string) {
  if (dbType === "mongodb") return "javascript";
  if (dbType === "redis") return "plaintext";
  return "sql";
}

function getCommentPrefix(dbType: string) {
  if (dbType === "mongodb") return "//";
  if (dbType === "redis") return "#";
  return "--";
}

export function buildSqlAiEditorPrompt(input: { dbType: string; prompt: string }) {
  return [
    "Generate a suggested database snippet for the editor.",
    `Target language: ${getTargetLanguage(input.dbType)}.`,
    "Return exactly one fenced code block followed by a short explanation.",
    "Do not add any prose before the code block.",
    "After the code block, add 1 to 3 short lines explaining what the query does.",
    "Keep the snippet ready for review in an editor.",
    "If the request implies a mutation, still return it as a suggested snippet only.",
    "",
    "User request:",
    input.prompt.trim(),
  ].join("\n");
}

export function extractFirstCodeBlock(value: string) {
  const match = value.match(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/);
  return (match?.[1] || value).trim();
}

export function extractExplanationText(value: string) {
  const withoutCodeBlock = value.replace(/```[a-zA-Z0-9_-]*\n?[\s\S]*?```/, "").trim();
  return withoutCodeBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function formatAiSnippetForEditor(input: {
  dbType: string;
  snippet: string;
  explanation?: string[];
}) {
  const prefix = getCommentPrefix(input.dbType);
  const snippet = input.snippet.trim();
  const explanation = (input.explanation || []).map((line) => `${prefix} ${line}`);

  return explanation.length > 0 ? [snippet, "", ...explanation].join("\n") : snippet;
}

export function buildLightSchemaContext(
  schemaData: Record<string, SchemaEntry>,
  fallbackSchema?: string,
): LightSchemaContextTable[] {
  return Object
    .values(schemaData || {})
    .map((entry) => ({
      schema: String(entry?.schema || fallbackSchema || "public"),
      table: String(entry?.name || ""),
      columns: Array.isArray(entry?.columns)
        ? entry.columns
          .map((column) => ({
            name: String(column?.name || ""),
            type: String(column?.type || "text"),
          }))
          .filter((column) => column.name.length > 0)
          .slice(0, 30)
        : [],
    }))
    .filter((entry) => entry.table.length > 0);
}
