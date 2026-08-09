import { executeQuery } from "@/lib/db/pg-client";
import { AgentTool, AgentToolContext, AgentToolResult, JsonSchema, JsonValue, ToolArgs } from "@/tools/types";

function ok(data: JsonValue): AgentToolResult {
  return { ok: true, data };
}

function fail(error: unknown): AgentToolResult {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return { ok: false, error: message };
}

function toJsonValue(input: unknown): JsonValue {
  return JSON.parse(JSON.stringify(input ?? null)) as JsonValue;
}

function getOptionalString(args: ToolArgs, key: string): string | null {
  const raw = args[key];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new Error(`Argument \"${key}\" must be a string.`);
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function getRequiredString(args: ToolArgs, key: string): string {
  const value = getOptionalString(args, key);
  if (!value) {
    throw new Error(`Missing required argument: ${key}`);
  }
  return value;
}

function getPositiveInt(args: ToolArgs, key: string, fallback: number): number {
  const raw = args[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`Argument \"${key}\" must be a number.`);
  }
  const normalized = Math.floor(raw);
  if (normalized <= 0) {
    throw new Error(`Argument \"${key}\" must be greater than 0.`);
  }
  return normalized;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeRoles(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }

  const raw = String(input || "").trim();
  if (!raw) return [];

  if (raw.startsWith("{") && raw.endsWith("}")) {
    const content = raw.slice(1, -1).trim();
    if (!content) return [];
    return content
      .split(",")
      .map((entry) => entry.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }

  return [raw];
}

function buildPolicyDeclaration(row: Record<string, unknown>): string {
  const schema = String(row.schema || "");
  const tableName = String(row.table_name || "");
  const name = String(row.name || "");
  const permissive = String(row.permissive || "PERMISSIVE").toUpperCase();
  const command = String(row.command || "ALL").toUpperCase();
  const roles = normalizeRoles(row.roles);
  const usingExpression = row.using_expression ? String(row.using_expression) : "";
  const withCheckExpression = row.with_check_expression ? String(row.with_check_expression) : "";

  const roleClause = roles.length
    ? roles
      .map((role) => (role.toLowerCase() === "public" ? "PUBLIC" : quoteIdent(role)))
      .join(", ")
    : "PUBLIC";

  let sql = `CREATE POLICY ${quoteIdent(name)} ON ${quoteIdent(schema)}.${quoteIdent(tableName)} AS ${permissive} FOR ${command} TO ${roleClause}`;
  if (usingExpression) {
    sql += ` USING (${usingExpression})`;
  }
  if (withCheckExpression) {
    sql += ` WITH CHECK (${withCheckExpression})`;
  }
  return `${sql};`;
}

function ensureReadOnlySql(sql: string): void {
  const normalized = sql.trim().replace(/;+$/g, "");
  if (!normalized) {
    throw new Error("SQL is required.");
  }

  const readOnlyPrefix = /^(select|with|explain)\b/i;
  if (!readOnlyPrefix.test(normalized)) {
    throw new Error("Only read-only SQL is allowed. Query must start with SELECT, WITH, or EXPLAIN.");
  }

  const blocked = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|comment|vacuum|analyze|refresh|reindex|call|do|copy)\b/i;
  if (blocked.test(normalized)) {
    throw new Error("Read-only SQL helper rejected a potentially mutating statement.");
  }
}

function tableParams(schemaRequired = true, extra: Record<string, JsonSchema> = {}): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  if (schemaRequired) {
    properties.schema = { type: "string", description: "Schema name." };
    properties.table_name = { type: "string", description: "Table name." };
  }
  for (const [key, val] of Object.entries(extra)) {
    properties[key] = val;
  }
  return {
    type: "object",
    properties,
    required: schemaRequired ? ["schema", "table_name"] : [],
    additionalProperties: false,
  };
}

function schemaOnlyParams(): JsonSchema {
  return {
    type: "object",
    properties: {
      schema: { type: "string", description: "Optional schema filter." },
    },
    required: [],
    additionalProperties: false,
  };
}

function toolDef(
  name: string,
  description: string,
  parameters: JsonSchema,
  execute: (args: ToolArgs, context: AgentToolContext) => Promise<JsonValue>,
): AgentTool {
  return {
    provider: "postgres",
    name,
    description,
    parameters,
    execute: async (args, context) => {
      try {
        return ok(toJsonValue(await execute(args, context)));
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function tableToolDef(
  name: string,
  description: string,
  execute: (schema: string, tableName: string, context: AgentToolContext) => Promise<JsonValue>,
): AgentTool {
  return toolDef(name, description, tableParams(), async (args, context) => {
    const schema = getRequiredString(args, "schema");
    const tableName = getRequiredString(args, "table_name");
    return execute(schema, tableName, context);
  });
}

export const postgresTools: AgentTool[] = [
  {
    provider: "postgres",
    name: "list_schemas",
    description: "List non-system PostgreSQL schemas.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    execute: async (_args, context) => {
      try {
        const res = await executeQuery(
          context.connectionString,
          `
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
              AND schema_name NOT LIKE 'pg_toast%'
            ORDER BY schema_name;
          `,
        );
        return ok(toJsonValue({ schemas: res.rows.map((row: Record<string, unknown>) => row.schema_name) }));
      } catch (error) {
        return fail(error);
      }
    },
  },
  toolDef("list_tables", "List tables in PostgreSQL schemas.", schemaOnlyParams(), async (args, context) => {
    const schema = getOptionalString(args, "schema");
    const res = await executeQuery(
      context.connectionString,
      `
        SELECT table_schema AS schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('information_schema', 'pg_catalog')
          AND table_schema NOT LIKE 'pg_toast%'
          AND ($1::text IS NULL OR table_schema = $1)
        ORDER BY table_schema, table_name;
      `,
      [schema],
    );
    return { tables: res.rows } as JsonValue;
  }),
  toolDef("list_views", "List regular and materialized views.", schemaOnlyParams(), async (args, context) => {
    const schema = getOptionalString(args, "schema");
    const res = await executeQuery(
      context.connectionString,
      `
        SELECT table_schema AS schema, table_name AS name, 'view' AS kind
        FROM information_schema.views
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
          AND ($1::text IS NULL OR table_schema = $1)
        UNION ALL
        SELECT schemaname AS schema, matviewname AS name, 'materialized_view' AS kind
        FROM pg_matviews
        WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
          AND ($1::text IS NULL OR schemaname = $1)
        ORDER BY schema, name;
      `,
      [schema],
    );
    return { views: res.rows } as JsonValue;
  }),
  {
    provider: "postgres",
    name: "list_functions",
    description: "List PostgreSQL functions/procedures with signatures.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Optional schema filter." },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      try {
        const schema = getOptionalString(args, "schema") ?? context.defaultSchema ?? null;
        const res = await executeQuery(
          context.connectionString,
          `
            SELECT
              n.nspname AS schema,
              p.proname AS name,
              pg_get_function_identity_arguments(p.oid) AS identity_arguments,
              pg_get_function_result(p.oid) AS return_type,
              CASE p.prokind
                WHEN 'p' THEN 'PROCEDURE'
                WHEN 'a' THEN 'AGGREGATE'
                WHEN 'w' THEN 'WINDOW'
                ELSE 'FUNCTION'
              END AS kind,
              l.lanname AS language
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_language l ON l.oid = p.prolang
            WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
              AND ($1::text IS NULL OR n.nspname = $1)
            ORDER BY n.nspname, p.proname, identity_arguments;
          `,
          [schema],
        );
        return ok(toJsonValue({ functions: res.rows }));
      } catch (error) {
        return fail(error);
      }
    },
  },
  toolDef("list_triggers", "List user-defined triggers with trigger declarations.", schemaOnlyParams(), async (args, context) => {
    const schema = getOptionalString(args, "schema");
    const res = await executeQuery(
      context.connectionString,
      `
        SELECT
          n.nspname AS schema,
          c.relname AS table_name,
          t.tgname AS name,
          CASE t.tgenabled
            WHEN 'O' THEN 'enabled'
            WHEN 'D' THEN 'disabled'
            WHEN 'R' THEN 'replica'
            WHEN 'A' THEN 'always'
            ELSE 'unknown'
          END AS status,
          pg_get_triggerdef(t.oid, true) AS declaration
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal
          AND n.nspname NOT IN ('information_schema', 'pg_catalog')
          AND ($1::text IS NULL OR n.nspname = $1)
        ORDER BY n.nspname, c.relname, t.tgname;
      `,
      [schema],
    );
    return { triggers: res.rows } as JsonValue;
  }),
  {
    provider: "postgres",
    name: "list_enum_type_values",
    description: "List enum types and their ordered values.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Optional schema filter." },
        type_name: { type: "string", description: "Optional enum type name filter." },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      try {
        const schema = getOptionalString(args, "schema");
        const typeName = getOptionalString(args, "type_name");
        const res = await executeQuery(
          context.connectionString,
          `
            SELECT
              n.nspname AS schema,
              t.typname AS type_name,
              e.enumsortorder AS sort_order,
              e.enumlabel AS value
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
              AND ($1::text IS NULL OR n.nspname = $1)
              AND ($2::text IS NULL OR t.typname = $2)
            ORDER BY n.nspname, t.typname, e.enumsortorder;
          `,
          [schema, typeName],
        );

        const grouped = new Map<string, { schema: string; type_name: string; values: string[] }>();
        for (const row of res.rows) {
          const key = `${String(row.schema)}.${String(row.type_name)}`;
          if (!grouped.has(key)) {
            grouped.set(key, {
              schema: String(row.schema),
              type_name: String(row.type_name),
              values: [],
            });
          }
          grouped.get(key)?.values.push(String(row.value));
        }

        return ok(toJsonValue({ enum_types: Array.from(grouped.values()) }));
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    provider: "postgres",
    name: "list_rls_policies",
    description: "List row-level security (RLS) policies for tables.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Optional schema filter." },
        table_name: { type: "string", description: "Optional table filter." },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      try {
        const schema = getOptionalString(args, "schema");
        const tableName = getOptionalString(args, "table_name");

        const res = await executeQuery(
          context.connectionString,
          `
            SELECT
              p.schemaname AS schema,
              p.tablename AS table_name,
              p.policyname AS name,
              p.permissive,
              p.roles,
              p.cmd AS command,
              p.qual AS using_expression,
              p.with_check AS with_check_expression,
              c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced
            FROM pg_policies p
            JOIN pg_namespace n ON n.nspname = p.schemaname
            JOIN pg_class c
              ON c.relname = p.tablename
             AND c.relnamespace = n.oid
            WHERE p.schemaname NOT IN ('information_schema', 'pg_catalog')
              AND ($1::text IS NULL OR p.schemaname = $1)
              AND ($2::text IS NULL OR p.tablename = $2)
            ORDER BY p.schemaname, p.tablename, p.policyname;
          `,
          [schema, tableName],
        );

        const policies = res.rows.map((row: Record<string, unknown>) => ({
          ...row,
          declaration: buildPolicyDeclaration(row),
        }));

        return ok(toJsonValue({ policies }));
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    provider: "postgres",
    name: "view_function_declaration",
    description: "View full CREATE FUNCTION/PROCEDURE declaration via pg_get_functiondef.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name." },
        function_name: { type: "string", description: "Function or procedure name." },
        identity_arguments: {
          type: "string",
          description: "Optional identity arguments to disambiguate overloaded functions (e.g. \"integer, text\").",
        },
      },
      required: ["schema", "function_name"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      try {
        const schema = getRequiredString(args, "schema");
        const functionName = getRequiredString(args, "function_name");
        const identityArguments = getOptionalString(args, "identity_arguments");

        const res = await executeQuery(
          context.connectionString,
          `
            SELECT
              p.oid,
              n.nspname AS schema,
              p.proname AS name,
              pg_get_function_identity_arguments(p.oid) AS identity_arguments,
              pg_get_functiondef(p.oid) AS declaration
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1
              AND p.proname = $2
              AND ($3::text IS NULL OR pg_get_function_identity_arguments(p.oid) = $3)
            ORDER BY p.oid;
          `,
          [schema, functionName, identityArguments],
        );

        if (!res.rows.length) {
          return { ok: false, error: `No function found for ${schema}.${functionName}` };
        }

        return ok(toJsonValue({ declarations: res.rows }));
      } catch (error) {
        return fail(error);
      }
    },
  },
  tableToolDef(
    "view_table_declaration",
    "View a table declaration summary, including generated CREATE TABLE SQL and related metadata.",
    async (schema, tableName, context) => {
      const [columnsRes, constraintsRes, indexesRes, rlsRes] = await Promise.all([
        executeQuery(
          context.connectionString,
          `
            SELECT
              a.attnum AS ordinal_position,
              a.attname AS column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              NOT a.attnotnull AS is_nullable,
              pg_get_expr(ad.adbin, ad.adrelid) AS column_default
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE n.nspname = $1
              AND c.relname = $2
              AND c.relkind IN ('r', 'p')
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum;
          `,
          [schema, tableName],
        ),
        executeQuery(
          context.connectionString,
          `
            SELECT
              con.conname AS name,
              con.contype AS type,
              pg_get_constraintdef(con.oid, true) AS definition
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relname = $2
            ORDER BY con.contype, con.conname;
          `,
          [schema, tableName],
        ),
        executeQuery(
          context.connectionString,
          `
            SELECT
              indexname AS name,
              indexdef AS definition
            FROM pg_indexes
            WHERE schemaname = $1
              AND tablename = $2
            ORDER BY indexname;
          `,
          [schema, tableName],
        ),
        executeQuery(
          context.connectionString,
          `
            SELECT
              c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relname = $2
              AND c.relkind IN ('r', 'p')
            LIMIT 1;
          `,
          [schema, tableName],
        ),
      ]);

      if (!columnsRes.rows.length) {
        throw new Error(`Table not found: ${schema}.${tableName}`);
      }

      const declarationLines: string[] = [];
      for (const column of columnsRes.rows) {
        const nullable = column.is_nullable ? "" : " NOT NULL";
        const defaultSql = column.column_default ? ` DEFAULT ${String(column.column_default)}` : "";
        declarationLines.push(
          `${quoteIdent(String(column.column_name))} ${String(column.data_type)}${defaultSql}${nullable}`,
        );
      }

      for (const constraint of constraintsRes.rows) {
        declarationLines.push(
          `CONSTRAINT ${quoteIdent(String(constraint.name))} ${String(constraint.definition)}`,
        );
      }

      const createTableSql = `CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(tableName)} (\n  ${declarationLines.join(",\n  ")}\n);`;

      return {
        schema,
        table_name: tableName,
        create_table_sql: createTableSql,
        columns: columnsRes.rows,
        constraints: constraintsRes.rows,
        indexes: indexesRes.rows,
        rls: rlsRes.rows[0] || { rls_enabled: false, rls_forced: false },
      };
    },
  ),
  {
    provider: "postgres",
    name: "view_rls_declaration",
    description: "View table RLS enable/force statements and CREATE POLICY declarations.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name." },
        table_name: { type: "string", description: "Table name." },
        policy_name: { type: "string", description: "Optional policy name filter." },
      },
      required: ["schema", "table_name"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      try {
        const schema = getRequiredString(args, "schema");
        const tableName = getRequiredString(args, "table_name");
        const policyName = getOptionalString(args, "policy_name");

        const [tableRes, policiesRes] = await Promise.all([
          executeQuery(
            context.connectionString,
            `
              SELECT
                c.relrowsecurity AS rls_enabled,
                c.relforcerowsecurity AS rls_forced
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1
                AND c.relname = $2
                AND c.relkind IN ('r', 'p')
              LIMIT 1;
            `,
            [schema, tableName],
          ),
          executeQuery(
            context.connectionString,
            `
              SELECT
                p.schemaname AS schema,
                p.tablename AS table_name,
                p.policyname AS name,
                p.permissive,
                p.roles,
                p.cmd AS command,
                p.qual AS using_expression,
                p.with_check AS with_check_expression
              FROM pg_policies p
              WHERE p.schemaname = $1
                AND p.tablename = $2
                AND ($3::text IS NULL OR p.policyname = $3)
              ORDER BY p.policyname;
            `,
            [schema, tableName, policyName],
          ),
        ]);

        if (!tableRes.rows.length) {
          return { ok: false, error: `Table not found: ${schema}.${tableName}` };
        }

        const tableInfo = tableRes.rows[0] as Record<string, unknown>;
        const declarations: string[] = [];

        if (tableInfo.rls_enabled) {
          declarations.push(`ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(tableName)} ENABLE ROW LEVEL SECURITY;`);
        }
        if (tableInfo.rls_forced) {
          declarations.push(`ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(tableName)} FORCE ROW LEVEL SECURITY;`);
        }

        for (const policy of policiesRes.rows) {
          declarations.push(buildPolicyDeclaration(policy as Record<string, unknown>));
        }

        return ok(
          toJsonValue({
            schema,
            table_name: tableName,
            declarations,
            policies: policiesRes.rows,
            rls_enabled: Boolean(tableInfo.rls_enabled),
            rls_forced: Boolean(tableInfo.rls_forced),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  },
  tableToolDef(
    "describe_table_columns",
    "List detailed column metadata for a table.",
    async (schema, tableName, context) => {
      const res = await executeQuery(
        context.connectionString,
        `
          SELECT
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            c.column_default,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.datetime_precision
          FROM information_schema.columns c
          WHERE c.table_schema = $1
            AND c.table_name = $2
          ORDER BY c.ordinal_position;
        `,
        [schema, tableName],
      );

      return { schema, table_name: tableName, columns: res.rows };
    },
  ),
  {
    provider: "postgres",
    name: "validate_dashboard_widget_queries",
    description: "Validate dashboard widget SQL queries in batch and report pass/fail per widget.",
    parameters: {
      type: "object",
      properties: {
        widgets: {
          type: "array",
          description: "Widget query candidates to validate.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Optional widget title for reporting." },
              query: { type: "string", description: "Read-only SQL query to validate." },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
        max_rows: { type: "number", description: "Optional row limit used when validating each query." },
      },
      required: ["widgets"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      try {
        const rawWidgets = args.widgets;
        if (!Array.isArray(rawWidgets)) {
          throw new Error("Argument \"widgets\" must be an array.");
        }
        if (rawWidgets.length === 0) {
          throw new Error("Argument \"widgets\" must contain at least one query.");
        }

        const defaultMaxRows = context.defaultMaxRows && context.defaultMaxRows > 0 ? context.defaultMaxRows : 1;
        const maxRows = getPositiveInt(args, "max_rows", Math.min(defaultMaxRows, 5));
        const widgets = rawWidgets.slice(0, 30);
        const results: Array<{
          index: number;
          title: string;
          query: string;
          ok: boolean;
          row_count?: number;
          fields?: string[];
          duration_ms: number;
          error?: string;
        }> = [];

        for (let index = 0; index < widgets.length; index += 1) {
          const widget = widgets[index];
          const title = widget && typeof widget === "object" && typeof (widget as Record<string, unknown>).title === "string"
            ? String((widget as Record<string, unknown>).title || "").trim()
            : "";
          const query = widget && typeof widget === "object" && typeof (widget as Record<string, unknown>).query === "string"
            ? String((widget as Record<string, unknown>).query || "").trim()
            : "";

          const startedAt = Date.now();
          if (!query) {
            results.push({
              index,
              title: title || `Widget ${index + 1}`,
              query,
              ok: false,
              duration_ms: Date.now() - startedAt,
              error: "Missing query.",
            });
            continue;
          }

          try {
            ensureReadOnlySql(query);
            const trimmedSql = query.replace(/;+\s*$/g, "");
            const isExplain = /^explain\b/i.test(trimmedSql);
            const executableSql = isExplain
              ? trimmedSql
              : `SELECT * FROM (${trimmedSql}) AS _rexadb_tool_validate_query LIMIT ${maxRows}`;
            const res = await executeQuery(context.connectionString, executableSql);

            results.push({
              index,
              title: title || `Widget ${index + 1}`,
              query,
              ok: true,
              row_count: res.rowCount,
              fields: Array.isArray(res.fields) ? res.fields.map((field: Record<string, unknown>) => String(field.name || "")) : [],
              duration_ms: Date.now() - startedAt,
            });
          } catch (error) {
            results.push({
              index,
              title: title || `Widget ${index + 1}`,
              query,
              ok: false,
              duration_ms: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error || "Validation failed."),
            });
          }
        }

        const passed = results.filter((item) => item.ok).length;
        const failed = results.length - passed;
        return ok(toJsonValue({
          total: results.length,
          passed,
          failed,
          max_rows: maxRows,
          results,
        }));
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    provider: "postgres",
    name: "run_readonly_sql",
    description: "Run a read-only SQL query (SELECT/WITH/EXPLAIN only).",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Read-only SQL query to execute." },
        max_rows: { type: "number", description: "Optional hard row limit for output." },
      },
      required: ["sql"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      try {
        const sql = getRequiredString(args, "sql");
        ensureReadOnlySql(sql);

        const defaultMaxRows = context.defaultMaxRows && context.defaultMaxRows > 0 ? context.defaultMaxRows : 200;
        const maxRows = getPositiveInt(args, "max_rows", defaultMaxRows);

        const trimmedSql = sql.replace(/;+\s*$/g, "");
        const isExplain = /^explain\b/i.test(trimmedSql);
        const executableSql = isExplain
          ? trimmedSql
          : `SELECT * FROM (${trimmedSql}) AS _rexadb_tool_query LIMIT ${maxRows}`;
        const res = await executeQuery(context.connectionString, executableSql);

        return ok(
          toJsonValue({
            max_rows: maxRows,
            row_count: res.rowCount,
            fields: res.fields,
            rows: res.rows,
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  },
];
