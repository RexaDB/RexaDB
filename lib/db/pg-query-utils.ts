// fallow-ignore-file code-duplication
export function buildSelectByKeyValuesQuery(
  schema: string,
  table: string,
  keyValues: Record<string, unknown>,
): { query: string; values: unknown[] } | null {
  const entries = Object.entries(keyValues || {}).filter(([key]) => key);
  if (entries.length === 0) return null;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;
  for (const [key, val] of entries) {
    if (val === null) {
      conditions.push(`"${key}" IS NULL`);
    } else {
      conditions.push(`"${key}" = $${paramIndex}`);
      values.push(val);
      paramIndex += 1;
    }
  }
  const query = `SELECT * FROM "${schema}"."${table}" WHERE ${conditions.join(" AND ")} LIMIT 1`;
  return { query, values };
}
