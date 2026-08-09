export function toFederatedSqliteType(dataType: string) {
  const raw = String(dataType || "").toLowerCase();
  if (/int|serial|bigint|smallint/.test(raw)) return "INTEGER";
  if (/real|double|float|numeric|decimal/.test(raw)) return "REAL";
  if (/blob|binary|bytea/.test(raw)) return "BLOB";
  return "TEXT";
}
