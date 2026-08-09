export function buildFederatedFields(rows: Record<string, unknown>[]) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).map((name) => ({
    name,
    dataTypeID: 0,
    dataTypeName: "unknown",
  }));
}
