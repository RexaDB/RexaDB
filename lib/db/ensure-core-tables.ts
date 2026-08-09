import userColumnMigrations from "./user-column-migrations.json";

let coreTablesEnsured = false;

type ColumnDef = { name: string; type: string; constraints?: string };

async function createTableIfNotExists(tableName: string, columns: ColumnDef[]) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  const colDefs = columns.map(c => `        ${c.name} ${c.type}${c.constraints ? " " + c.constraints : ""}`).join(",\n");
  await db.run(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${tableName}" (
${colDefs}
    )
  `));
}

export async function ensureCoreTables() {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");

  async function ensureColumns(
    tableName: string,
    migrations: Array<{ column: string; statement: string }>,
  ) {
    const rows = await db.all<{ name?: string }>(sql.raw(`PRAGMA table_info(${tableName})`));
    if (rows.length === 0) return;
    const existingColumns = new Set(
      rows.map((row) => String(row?.name || "").trim().toLowerCase()).filter(Boolean)
    );
    for (const migration of migrations) {
      if (existingColumns.has(migration.column)) continue;
      await db.run(sql.raw(migration.statement));
    }
  }

  const coreMigrationPromises = () => [
    ensureColumns("connection_settings", [
      { column: "sidebar_behavior", statement: "ALTER TABLE connection_settings ADD COLUMN sidebar_behavior TEXT DEFAULT 'expandable'" },
      { column: "agent_provider", statement: "ALTER TABLE connection_settings ADD COLUMN agent_provider TEXT DEFAULT 'openai'" },
      { column: "agent_model", statement: "ALTER TABLE connection_settings ADD COLUMN agent_model TEXT" },
      { column: "agent_api_key", statement: "ALTER TABLE connection_settings ADD COLUMN agent_api_key TEXT" },
      { column: "tui_mode", statement: "ALTER TABLE connection_settings ADD COLUMN tui_mode INTEGER DEFAULT 0" },
      { column: "tui_theme", statement: "ALTER TABLE connection_settings ADD COLUMN tui_theme TEXT DEFAULT 'auto'" },
      { column: "sql_editor_engine", statement: "ALTER TABLE connection_settings ADD COLUMN sql_editor_engine TEXT DEFAULT 'custom'" },
      { column: "editor_theme_id", statement: "ALTER TABLE connection_settings ADD COLUMN editor_theme_id TEXT DEFAULT 'auto'" },
      { column: "custom_editor_themes", statement: "ALTER TABLE connection_settings ADD COLUMN custom_editor_themes TEXT" },
      { column: "app_theme_id", statement: "ALTER TABLE connection_settings ADD COLUMN app_theme_id TEXT DEFAULT 'zinc-dark-white'" },
      { column: "custom_app_themes", statement: "ALTER TABLE connection_settings ADD COLUMN custom_app_themes TEXT" },
      { column: "split_view", statement: "ALTER TABLE connection_settings ADD COLUMN split_view TEXT" },
      { column: "vim_mode", statement: "ALTER TABLE connection_settings ADD COLUMN vim_mode INTEGER DEFAULT 0" },
      { column: "settings_json", statement: "ALTER TABLE connection_settings ADD COLUMN settings_json TEXT" },
    ]),
    ensureColumns("open_tabs", [
      { column: "pinned", statement: "ALTER TABLE open_tabs ADD COLUMN pinned INTEGER DEFAULT 0" },
    ]),
    ensureColumns("query_history", [
      { column: "executed_by", statement: "ALTER TABLE query_history ADD COLUMN executed_by TEXT" },
      { column: "executed_by_name", statement: "ALTER TABLE query_history ADD COLUMN executed_by_name TEXT" },
    ]),
    ensureColumns("folders", [
      { column: "created_at", statement: "ALTER TABLE folders ADD COLUMN created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)" },
      { column: "parent_id", statement: "ALTER TABLE folders ADD COLUMN parent_id TEXT" },
    ]),
    ensureColumns("snippets", [
      { column: "folder_id", statement: "ALTER TABLE snippets ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL" },
      { column: "created_at", statement: "ALTER TABLE snippets ADD COLUMN created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)" },
      { column: "is_shared", statement: "ALTER TABLE snippets ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0" },
      { column: "shared_entry_id", statement: "ALTER TABLE snippets ADD COLUMN shared_entry_id TEXT" },
    ]),
    ensureColumns("users", userColumnMigrations as any),
    ensureColumns("user_entitlements", [
      { column: "payload_json", statement: "ALTER TABLE user_entitlements ADD COLUMN payload_json TEXT NOT NULL DEFAULT ''" },
      { column: "signature", statement: "ALTER TABLE user_entitlements ADD COLUMN signature TEXT NOT NULL DEFAULT ''" },
      { column: "entitlement_plan_code", statement: "ALTER TABLE user_entitlements ADD COLUMN entitlement_plan_code TEXT NOT NULL DEFAULT 'free'" },
      { column: "last_paid_plan_code", statement: "ALTER TABLE user_entitlements ADD COLUMN last_paid_plan_code TEXT" },
      { column: "status", statement: "ALTER TABLE user_entitlements ADD COLUMN status TEXT NOT NULL DEFAULT 'none'" },
      { column: "cloud_enabled", statement: "ALTER TABLE user_entitlements ADD COLUMN cloud_enabled INTEGER NOT NULL DEFAULT 0" },
      { column: "max_connections", statement: "ALTER TABLE user_entitlements ADD COLUMN max_connections INTEGER" },
      { column: "max_workspaces", statement: "ALTER TABLE user_entitlements ADD COLUMN max_workspaces INTEGER" },
      { column: "access_ends_at", statement: "ALTER TABLE user_entitlements ADD COLUMN access_ends_at INTEGER" },
      { column: "grace_ends_at", statement: "ALTER TABLE user_entitlements ADD COLUMN grace_ends_at INTEGER" },
      { column: "updates_until", statement: "ALTER TABLE user_entitlements ADD COLUMN updates_until INTEGER" },
      { column: "issued_at", statement: "ALTER TABLE user_entitlements ADD COLUMN issued_at INTEGER NOT NULL DEFAULT 0" },
      { column: "refresh_after", statement: "ALTER TABLE user_entitlements ADD COLUMN refresh_after INTEGER NOT NULL DEFAULT 0" },
      { column: "last_observed_at", statement: "ALTER TABLE user_entitlements ADD COLUMN last_observed_at INTEGER NOT NULL DEFAULT 0" },
      { column: "synced_at", statement: "ALTER TABLE user_entitlements ADD COLUMN synced_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)" },
    ]),
    createTableIfNotExists("ai_chats", [
      { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
      { name: "connection_id", type: "INTEGER", constraints: "NOT NULL REFERENCES connections(id) ON DELETE CASCADE" },
      { name: "user_id", type: "TEXT", constraints: "REFERENCES users(id) ON DELETE SET NULL" },
      { name: "title", type: "TEXT", constraints: "NOT NULL" },
      { name: "created_at", type: "INTEGER", constraints: "NOT NULL" },
      { name: "updated_at", type: "INTEGER", constraints: "NOT NULL" },
    ]).then(() => db.run(sql`CREATE INDEX IF NOT EXISTS ai_chats_connection_updated_idx ON ai_chats(connection_id, updated_at DESC)`)),
    createTableIfNotExists("ai_chat_messages", [
      { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
      { name: "chat_id", type: "TEXT", constraints: "NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE" },
      { name: "role", type: "TEXT", constraints: "NOT NULL" },
      { name: "content", type: "TEXT", constraints: "NOT NULL" },
      { name: "meta_json", type: "TEXT" },
      { name: "timestamp", type: "INTEGER", constraints: "NOT NULL" },
    ]).then(async () => {
      await ensureColumns("ai_chat_messages", [
        { column: "meta_json", statement: "ALTER TABLE ai_chat_messages ADD COLUMN meta_json TEXT" },
      ]);
      await db.run(sql`CREATE INDEX IF NOT EXISTS ai_chat_messages_chat_timestamp_idx ON ai_chat_messages(chat_id, timestamp ASC)`);
    }),
    createTableIfNotExists("user_ai_settings", [
      { name: "user_id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
      { name: "settings_json", type: "TEXT", constraints: "NOT NULL" },
      { name: "updated_at", type: "INTEGER", constraints: "NOT NULL" },
    ]),
    createTableIfNotExists("dashboard_state", [
      { name: "connection_id", type: "INTEGER", constraints: "PRIMARY KEY NOT NULL REFERENCES connections(id) ON DELETE CASCADE" },
      { name: "dashboards_json", type: "TEXT", constraints: "NOT NULL" },
      { name: "folders_json", type: "TEXT", constraints: "NOT NULL" },
      { name: "updated_at", type: "INTEGER", constraints: "NOT NULL" },
    ]),
    createTableIfNotExists("workflows", [
      { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
      { name: "connection_id", type: "INTEGER", constraints: "REFERENCES connections(id) ON DELETE CASCADE" },
      { name: "name", type: "TEXT", constraints: "NOT NULL" },
      { name: "description", type: "TEXT" },
      { name: "nodes_json", type: "TEXT", constraints: "NOT NULL DEFAULT '[]'" },
      { name: "edges_json", type: "TEXT", constraints: "NOT NULL DEFAULT '[]'" },
      { name: "schedule_enabled", type: "INTEGER", constraints: "DEFAULT 0" },
      { name: "schedule_type", type: "TEXT" },
      { name: "schedule_value", type: "TEXT" },
      { name: "last_run_at", type: "INTEGER" },
      { name: "created_at", type: "INTEGER", constraints: "NOT NULL" },
      { name: "updated_at", type: "INTEGER", constraints: "NOT NULL" },
    ]).then(async () => {
      await ensureColumns("workflows", [
        { column: "connection_id", statement: "ALTER TABLE workflows ADD COLUMN connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE" },
        { column: "edges_json", statement: "ALTER TABLE workflows ADD COLUMN edges_json TEXT NOT NULL DEFAULT '[]'" },
      ]);
      await db.run(sql`CREATE INDEX IF NOT EXISTS workflows_connection_idx ON workflows(connection_id)`);
    }),
    createTableIfNotExists("workflow_runs", [
      { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
      { name: "workflow_id", type: "TEXT", constraints: "NOT NULL REFERENCES workflows(id) ON DELETE CASCADE" },
      { name: "status", type: "TEXT", constraints: "NOT NULL" },
      { name: "started_at", type: "INTEGER", constraints: "NOT NULL" },
      { name: "finished_at", type: "INTEGER" },
      { name: "nodes_output_json", type: "TEXT" },
      { name: "error", type: "TEXT" },
      { name: "trigger", type: "TEXT", constraints: "NOT NULL" },
    ]).then(() => db.run(sql`CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON workflow_runs(workflow_id, started_at DESC)`)),
  ];

  if (coreTablesEnsured) {
    await Promise.all([
      ensureColumns("connections", [
        { column: "sort_order", statement: "ALTER TABLE connections ADD COLUMN sort_order INTEGER" },
        { column: "connection_type", statement: "ALTER TABLE connections ADD COLUMN connection_type TEXT" },
        { column: "environment", statement: "ALTER TABLE connections ADD COLUMN environment TEXT" },
        { column: "color", statement: "ALTER TABLE connections ADD COLUMN color TEXT" },
        { column: "group", statement: "ALTER TABLE connections ADD COLUMN \"group\" TEXT" },
        { column: "is_favorite", statement: "ALTER TABLE connections ADD COLUMN is_favorite INTEGER DEFAULT 0" },
        { column: "last_active", statement: "ALTER TABLE connections ADD COLUMN last_active INTEGER" },
      ]).then(() => db.run(sql`UPDATE connections SET sort_order = created_at WHERE sort_order IS NULL`)),
      ...coreMigrationPromises(),
    ]);
    return;
  }

  await db.run(sql`PRAGMA foreign_keys = ON`);

  await createTableIfNotExists("connections", [
    { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
    { name: "name", type: "TEXT", constraints: "NOT NULL" },
    { name: "connection_string", type: "TEXT", constraints: "NOT NULL" },
    { name: "connection_type", type: "TEXT" },
    { name: "created_at", type: "INTEGER", constraints: "NOT NULL" },
    { name: "sort_order", type: "INTEGER" },
    { name: "environment", type: "TEXT" },
    { name: "color", type: "TEXT" },
    { name: '"group"', type: "TEXT" },
    { name: "is_favorite", type: "INTEGER", constraints: "DEFAULT 0" },
    { name: "last_active", type: "INTEGER" },
  ]);
  await createTableIfNotExists("folders", [
    { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
    { name: "connection_id", type: "INTEGER", constraints: "REFERENCES connections(id) ON DELETE CASCADE" },
    { name: "name", type: "TEXT", constraints: "NOT NULL" },
    { name: "created_at", type: "INTEGER", constraints: "NOT NULL" },
  ]);
  await createTableIfNotExists("snippets", [
    { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
    { name: "connection_id", type: "INTEGER", constraints: "REFERENCES connections(id) ON DELETE CASCADE" },
    { name: "folder_id", type: "TEXT", constraints: "REFERENCES folders(id) ON DELETE SET NULL" },
    { name: "name", type: "TEXT", constraints: "NOT NULL" },
    { name: "query", type: "TEXT", constraints: "NOT NULL" },
    { name: "created_at", type: "INTEGER", constraints: "NOT NULL" },
    { name: "is_shared", type: "INTEGER", constraints: "NOT NULL DEFAULT 0" },
    { name: "shared_entry_id", type: "TEXT" },
  ]);
  const snippetVersionsInfo = await db.all<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='snippet_versions'`);
  if (snippetVersionsInfo.length > 0 && snippetVersionsInfo[0].sql?.toLowerCase().includes('references')) {
    await db.run(sql`DROP TABLE snippet_versions`);
  }
  await createTableIfNotExists("snippet_versions", [
    { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
    { name: "snippet_id", type: "TEXT", constraints: "NOT NULL" },
    { name: "name", type: "TEXT", constraints: "NOT NULL" },
    { name: "query", type: "TEXT", constraints: "NOT NULL" },
    { name: "version_number", type: "INTEGER", constraints: "NOT NULL" },
    { name: "created_at", type: "INTEGER", constraints: "NOT NULL" },
  ]);
  await createTableIfNotExists("query_history", [
    { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
    { name: "connection_id", type: "INTEGER", constraints: "REFERENCES connections(id) ON DELETE CASCADE" },
    { name: "query", type: "TEXT", constraints: "NOT NULL" },
    { name: "executed_at", type: "INTEGER", constraints: "NOT NULL" },
    { name: "duration", type: "INTEGER", constraints: "NOT NULL" },
    { name: "status", type: "TEXT", constraints: "NOT NULL" },
    { name: "error", type: "TEXT" },
    { name: "rows_count", type: "INTEGER" },
    { name: "caller", type: "TEXT", constraints: "NOT NULL" },
    { name: "executed_by", type: "TEXT" },
    { name: "executed_by_name", type: "TEXT" },
  ]);
  await createTableIfNotExists("tags", [
    { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
    { name: "connection_id", type: "INTEGER", constraints: "REFERENCES connections(id) ON DELETE CASCADE" },
    { name: "name", type: "TEXT", constraints: "NOT NULL" },
    { name: "color", type: "TEXT", constraints: "NOT NULL" },
  ]);
  await createTableIfNotExists("table_tags", [
    { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
    { name: "connection_id", type: "INTEGER", constraints: "REFERENCES connections(id) ON DELETE CASCADE" },
    { name: "table_name", type: "TEXT", constraints: "NOT NULL" },
    { name: "tag_name", type: "TEXT", constraints: "NOT NULL" },
  ]);
  await createTableIfNotExists("open_tabs", [
    { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
    { name: "connection_id", type: "INTEGER", constraints: "REFERENCES connections(id) ON DELETE CASCADE" },
    { name: "type", type: "TEXT", constraints: "NOT NULL" },
    { name: "name", type: "TEXT", constraints: "NOT NULL" },
    { name: "schema", type: "TEXT" },
    { name: "query", type: "TEXT" },
    { name: '"order"', type: "INTEGER", constraints: "NOT NULL" },
    { name: "pinned", type: "INTEGER", constraints: "DEFAULT 0" },
  ]);
  await     createTableIfNotExists("connection_groups", [
      { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
      { name: "name", type: "TEXT", constraints: "NOT NULL UNIQUE" },
      { name: "created_at", type: "INTEGER", constraints: "NOT NULL" },
    ]),
    createTableIfNotExists("connection_group_members", [
      { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
      { name: "connection_id", type: "INTEGER", constraints: "NOT NULL REFERENCES connections(id) ON DELETE CASCADE" },
      { name: "group_id", type: "INTEGER", constraints: "NOT NULL REFERENCES connection_groups(id) ON DELETE CASCADE" },
    ]),
    createTableIfNotExists("connection_settings", [
    { name: "connection_id", type: "INTEGER", constraints: "PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE" },
    { name: "active_tab_id", type: "TEXT" },
    { name: "sidebar_sort_mode", type: "TEXT", constraints: "DEFAULT 'alphabetical'" },
    { name: "sidebar_view", type: "TEXT", constraints: "DEFAULT 'tables'" },
    { name: "sidebar_behavior", type: "TEXT", constraints: "DEFAULT 'expandable'" },
    { name: "keybindings", type: "TEXT" },
    { name: "search_settings", type: "TEXT" },
    { name: "execution_mode", type: "TEXT", constraints: "DEFAULT 'review'" },
    { name: "row_spacing", type: "TEXT", constraints: "DEFAULT 'relaxed'" },
    { name: "alternating_row_colors", type: "INTEGER", constraints: "DEFAULT 0" },
    { name: "editor_font_size", type: "TEXT", constraints: "DEFAULT '12px'" },
    { name: "sql_editor_engine", type: "TEXT", constraints: "DEFAULT 'custom'" },
    { name: "editor_theme_id", type: "TEXT", constraints: "DEFAULT 'auto'" },
    { name: "custom_editor_themes", type: "TEXT" },
    { name: "app_theme_id", type: "TEXT", constraints: "DEFAULT 'zinc-dark-white'" },
    { name: "custom_app_themes", type: "TEXT" },
    { name: "tui_mode", type: "INTEGER", constraints: "DEFAULT 0" },
    { name: "tui_theme", type: "TEXT", constraints: "DEFAULT 'auto'" },
    { name: "command_menu_sections", type: "TEXT" },
    { name: "split_view", type: "TEXT" },
    { name: "agent_provider", type: "TEXT", constraints: "DEFAULT 'openai'" },
    { name: "agent_model", type: "TEXT" },
    { name: "agent_api_key", type: "TEXT" },
  ]);
  await createTableIfNotExists("schema_cache_meta", [
    { name: "connection_string", type: "TEXT", constraints: "PRIMARY KEY" },
    { name: "schemas_updated_at", type: "INTEGER" },
    { name: "tables_updated_at", type: "INTEGER" },
    { name: "columns_updated_at", type: "INTEGER" },
  ]);
  await createTableIfNotExists("schema_cache_schemas", [
    { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
    { name: "connection_string", type: "TEXT", constraints: "NOT NULL" },
    { name: "schema_name", type: "TEXT", constraints: "NOT NULL" },
  ]);
  await createTableIfNotExists("schema_cache_tables", [
    { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
    { name: "connection_string", type: "TEXT", constraints: "NOT NULL" },
    { name: "schema_name", type: "TEXT", constraints: "NOT NULL" },
    { name: "table_name", type: "TEXT", constraints: "NOT NULL" },
  ]);
  await createTableIfNotExists("schema_cache_columns", [
    { name: "id", type: "INTEGER", constraints: "PRIMARY KEY AUTOINCREMENT" },
    { name: "connection_string", type: "TEXT", constraints: "NOT NULL" },
    { name: "schema_name", type: "TEXT", constraints: "NOT NULL" },
    { name: "table_name", type: "TEXT", constraints: "NOT NULL" },
    { name: "column_name", type: "TEXT", constraints: "NOT NULL" },
    { name: "data_type", type: "TEXT" },
    { name: "is_nullable", type: "INTEGER", constraints: "DEFAULT 0" },
    { name: "is_primary", type: "INTEGER", constraints: "DEFAULT 0" },
    { name: "referenced_table_schema", type: "TEXT" },
    { name: "referenced_table_name", type: "TEXT" },
    { name: "referenced_column_name", type: "TEXT" },
  ]);
  await createTableIfNotExists("users", [
    { name: "id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL" },
    { name: "email", type: "TEXT" },
    { name: "name", type: "TEXT" },
    { name: "created_at", type: "INTEGER", constraints: "NOT NULL DEFAULT (strftime('%s','now')*1000)" },
    { name: "is_local", type: "INTEGER", constraints: "NOT NULL DEFAULT 1" },
    { name: "supabase_id", type: "TEXT" },
    { name: "plan_type", type: "TEXT", constraints: "NOT NULL DEFAULT 'free'" },
    { name: "plan_status", type: "TEXT", constraints: "NOT NULL DEFAULT 'none'" },
    { name: "plan_synced_at", type: "INTEGER" },
    { name: "plan_period_end", type: "INTEGER" },
  ]);
  await createTableIfNotExists("user_entitlements", [
    { name: "user_id", type: "TEXT", constraints: "PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE" },
    { name: "payload_json", type: "TEXT", constraints: "NOT NULL" },
    { name: "signature", type: "TEXT", constraints: "NOT NULL" },
    { name: "entitlement_plan_code", type: "TEXT", constraints: "NOT NULL" },
    { name: "last_paid_plan_code", type: "TEXT" },
    { name: "status", type: "TEXT", constraints: "NOT NULL" },
    { name: "cloud_enabled", type: "INTEGER", constraints: "NOT NULL DEFAULT 0" },
    { name: "max_connections", type: "INTEGER" },
    { name: "max_workspaces", type: "INTEGER" },
    { name: "access_ends_at", type: "INTEGER" },
    { name: "grace_ends_at", type: "INTEGER" },
    { name: "updates_until", type: "INTEGER" },
    { name: "issued_at", type: "INTEGER", constraints: "NOT NULL" },
    { name: "refresh_after", type: "INTEGER", constraints: "NOT NULL" },
    { name: "last_observed_at", type: "INTEGER", constraints: "NOT NULL DEFAULT 0" },
    { name: "synced_at", type: "INTEGER", constraints: "NOT NULL DEFAULT (strftime('%s','now')*1000)" },
  ]);

  await Promise.all(coreMigrationPromises());

  coreTablesEnsured = true;
}

export async function ensureConnectionExists(connectionId: number) {
  if (!Number.isInteger(connectionId) || connectionId <= 0) return;

  const { db } = await import("./index");
  const { connections } = await import("./schema");
  const { eq } = await import("drizzle-orm");

  await ensureCoreTables();
  const existing = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  if (existing.length > 0) return;

  await db
    .insert(connections)
    .values({
      id: connectionId,
      name: `Dev Connection ${connectionId}`,
      connectionString: `dev://local/${connectionId}`,
      createdAt: new Date(),
      sortOrder: Date.now(),
    })
    .onConflictDoNothing();
}
