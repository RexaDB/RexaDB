export function normalizePgSyntax(query: string) {
  return String(query || "")
    .replace(/SELECT\s+ALL\s+FROM/gi, "SELECT * FROM")
    .replace(/;\s*(UNION ALL|UNION|INTERSECT|EXCEPT)\b/gi, " $1");
}
