export function normalizeFederatedValue(value: unknown) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && !(value instanceof Uint8Array)) {
    return JSON.stringify(value);
  }
  return value;
}
