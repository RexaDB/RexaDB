export function supportsInfiniteTableScrolling(dbType: string, structure: ReadonlyArray<{ is_primary_key?: boolean }>): boolean {
  return dbType === "mongodb" || (dbType !== "redis" && structure.some((column) => column.is_primary_key));
}

export function shouldLoadTableBatch({
  visibleEnd,
  rowCount,
  loading,
  hasMore,
  error,
}: {
  visibleEnd: number;
  rowCount: number;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
}): boolean {
  return rowCount > 0 && visibleEnd >= rowCount - 20 && !loading && hasMore && !error;
}

export function mergeTableBatch<T extends { rows: unknown[]; fields?: unknown[] }>(previous: T, batch: T): T {
  const merged = { ...previous, ...batch, rows: [...previous.rows, ...batch.rows] };
  if (!batch.fields?.length && previous.fields) merged.fields = previous.fields;
  return merged;
}

export function hasMoreTableRows(batchCount: number, batchSize: number, loadedCount: number, totalCount: number | null): boolean {
  return batchCount >= batchSize && (totalCount === null || loadedCount < totalCount);
}
