import { normalizeJsonInput } from "@/lib/studio/general-utils";

export function normalizeJsonColumnValue(
  value: any,
  columnName: string,
  isJsonColumn: boolean,
): { value: any; error?: string } {
  if (!isJsonColumn) return { value };
  const normalized = normalizeJsonInput(value, columnName);
  if (normalized.error) {
    return { value, error: normalized.error };
  }
  return { value: normalized.value };
}
