export function supportsWithCheck(command: string): boolean {
  const v = command.toLowerCase();
  return v === "all" || v === "insert" || v === "update";
}

export function quoteRoles(roles: string[]): string {
  if (!roles.length) return "PUBLIC";
  return roles
    .map((role) => {
      if (role.toLowerCase() === "public") return "PUBLIC";
      return `"${role.replace(/"/g, '""')}"`;
    })
    .join(", ");
}

export function buildCreateSql(
  schema: string,
  table: string,
  values: {
    name: string;
    command?: string | null;
    permissive?: string | null;
    roles: string[];
    usingExpression?: string | null;
    withCheckExpression?: string | null;
  },
): string {
  const command = (values.command || "all").toUpperCase();
  const usingClause = values.usingExpression
    ? ` USING (${values.usingExpression})`
    : "";
  const withCheckClause =
    supportsWithCheck(values.command || "all") && values.withCheckExpression
      ? ` WITH CHECK (${values.withCheckExpression})`
      : "";
  return `CREATE POLICY "${values.name}" ON "${schema}"."${table}" AS ${values.permissive} FOR ${command} TO ${quoteRoles(values.roles)}${usingClause}${withCheckClause};`;
}
