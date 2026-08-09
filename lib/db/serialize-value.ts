export function serializeValue(
  value: any,
  custom?: (v: any) => any | undefined,
): any {
  if (value === null || value === undefined) return value;
  if (custom) {
    const result = custom(value);
    if (result !== undefined) return result;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map((v) => serializeValue(v, custom));
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v, custom);
    return out;
  }
  return value;
}
