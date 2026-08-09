function toPlainFederatedValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map((entry) => toPlainFederatedValue(entry));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toPlainFederatedValue(entry)])
    );
  }
  return value;
}

function toPlainFederatedRow(row: unknown) {
  if (!row || typeof row !== "object") return {};
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, toPlainFederatedValue(value)])
  );
}

export function toPlainFederatedRows(rows: unknown[]) {
  return rows.map((row) => toPlainFederatedRow(row));
}
