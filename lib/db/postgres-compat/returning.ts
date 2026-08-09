const RETURNING_RE = /\bRETURNING\b/i;

export function assertSupportedReturning(query: string, target: "postgres" | "sqlite" | "mysql") {
  if (target !== "mysql") return;
  if (!RETURNING_RE.test(query)) return;
  throw new Error("PostgreSQL RETURNING is not supported for MySQL yet.");
}
