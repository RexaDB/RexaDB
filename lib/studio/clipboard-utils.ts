import { stableStringify } from "@/lib/studio/general-utils";

const NEEDS_QUOTE = /["\n\r]/;

export function stringifyForClipboard(value: unknown) {
  if (value === null || value === undefined) return "";
  return stableStringify(value);
}

export function formatDelimitedValue(value: unknown, delimiter: string) {
  const raw = stringifyForClipboard(value);
  if (!raw) return "";
  const needsQuote = NEEDS_QUOTE.test(raw) || raw.includes(delimiter);
  if (!needsQuote) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

export function formatSqlLiteral(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const raw = stringifyForClipboard(value);
  return `'${raw.replace(/'/g, "''")}'`;
}
