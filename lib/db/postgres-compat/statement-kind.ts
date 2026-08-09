export function getStatementKind(query: string) {
  const match = String(query || "").trim().match(/^([a-z]+)/i);
  return String(match?.[1] || "").toUpperCase();
}
