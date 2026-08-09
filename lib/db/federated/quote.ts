export function quoteFederatedIdent(value: string) {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}
