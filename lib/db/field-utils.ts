export function inferFieldsFromRows(
  rows: unknown[],
): Array<{ name: string; dataTypeID: number; dataTypeName: string }> {
  const keys = Object.keys((rows[0] as Record<string, unknown>) || {}).filter(
    (k) => k && !/^\d+$/.test(k),
  );
  return keys.map((name) => ({
    name,
    dataTypeID: 0,
    dataTypeName: "unknown",
  }));
}
