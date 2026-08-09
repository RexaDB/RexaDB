export function compactFederatedQuery(query: string) {
  return String(query || "")
    .replace(/\s+\./g, ".")
    .replace(/\.\s+/g, ".");
}
