import { getCachedSchemasSnapshot, getCachedTablesSnapshot } from "./schema-cache-actions";
import { runCoreTransaction, withSqliteBusyRetry, formatDbError } from "./sqlite-helpers";
import { computeBasicStats, computeQueriesByDay, computeTopQueries } from "./analytics-utils";

export async function getStudioHistory(
  connectionId: number,
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { db } = await import("./index");
  const { queryHistory, connections } = await import("./schema");
  const { eq, asc } = await import("drizzle-orm");
  const { logHistoryOperation } = await import("./history-logger");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const rows = await db
      .select()
      .from(queryHistory)
      .leftJoin(connections, eq(queryHistory.connectionId, connections.id))
      .where(eq(queryHistory.connectionId, connectionId))
      .orderBy(asc(queryHistory.executedAt));

    const mappedRows = rows.map((row) => ({
      id: row.query_history.id,
      connectionId: row.query_history.connectionId,
      query: row.query_history.query,
      executedAt: row.query_history.executedAt,
      duration: row.query_history.duration,
      status: row.query_history.status,
      error: row.query_history.error,
      rowsCount: row.query_history.rowsCount,
      caller: row.query_history.caller,
      executedBy: row.query_history.executedBy,
      executedByName: row.query_history.executedByName,
      connectionName: row.connections?.name ?? null,
    }));

    await logHistoryOperation("load", connectionId, {
      historyCount: mappedRows.length,
      firstEntry: mappedRows[0]?.id,
      lastEntry: mappedRows[mappedRows.length - 1]?.id,
    });

    return { success: true, data: mappedRows };
  } catch (error) {
    console.error("Failed to fetch studio history:", error);
    await logHistoryOperation("error", connectionId, {
      operation: "load",
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Failed to fetch studio history" };
  }
}

export async function insertHistoryEntry(
  connectionId: number,
  entry: {
    id: string; query: string; executedAt: number; duration: number;
    status: "success" | "error"; error?: string | null; rowsCount?: number | null;
    caller: "user" | "system"; executedBy?: string | null; executedByName?: string | null;
  },
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { db } = await import("./index");
  const { queryHistory } = await import("./schema");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    await db.insert(queryHistory).values({
      id: entry.id, connectionId, query: entry.query, executedAt: entry.executedAt,
      duration: entry.duration, status: entry.status, error: entry.error ?? null,
      rowsCount: entry.rowsCount ?? null, caller: entry.caller,
      executedBy: entry.executedBy ?? null, executedByName: entry.executedByName ?? null,
    }).onConflictDoNothing();
    return { success: true };
  } catch (error) {
    console.error("[rexadb] insertHistoryEntry:error", { connectionId, entryId: entry.id, error });
    return { success: false };
  }
}

export async function clearStudioHistory(connectionId: number, ensureCoreTables: () => Promise<void>) {
  const { db } = await import("./index");
  const { queryHistory } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await db.delete(queryHistory).where(eq(queryHistory.connectionId, connectionId));
    return { success: true };
  } catch (error) {
    console.error("[rexadb] clearStudioHistory:error", { connectionId, error });
    return { success: false };
  }
}

export async function saveStudioHistory(
  connectionId: number,
  historyList: any[],
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { queryHistory } = await import("./schema");
  const { eq, sql } = await import("drizzle-orm");
  const { logHistoryOperation } = await import("./history-logger");

  try {
    await logHistoryOperation("save", connectionId, {
      inputCount: historyList.length,
      firstEntry: historyList[0]?.id,
      lastEntry: historyList[historyList.length - 1]?.id,
    });

    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const normalizedHistory = Array.isArray(historyList) ? historyList : [];
    const cleanHistory = normalizedHistory
      .map((h) => ({
        id: typeof h?.id === "string" || typeof h?.id === "number" ? String(h.id) : "",
        connectionId,
        query: typeof h?.query === "string" ? h.query : "",
        executedAt: Number.isFinite(h?.executedAt) ? Number(h.executedAt) : Date.now(),
        duration: Number.isFinite(h?.duration) ? Number(h.duration) : 0,
        status: h?.status === "success" || h?.status === "error" ? h.status : "success",
        error: typeof h?.error === "string" ? h.error : null,
        rowsCount: Number.isFinite(h?.rowsCount) ? Number(h.rowsCount) : null,
        caller: h?.caller === "user" || h?.caller === "system" ? h.caller : "user",
        executedBy: typeof h?.executedBy === "string" ? h.executedBy : null,
        executedByName: typeof h?.executedByName === "string" ? h.executedByName : null,
      }))
      .filter((entry) => entry.id && entry.query);
    const dedupedHistory = Array.from(
      new Map(cleanHistory.map((entry) => [entry.id, entry])).values()
    );
    await runCoreTransaction("saveStudioHistory", async (db) => {
      await db.delete(queryHistory).where(eq(queryHistory.connectionId, connectionId));
      if (dedupedHistory.length > 0) {
        await db.insert(queryHistory).values(dedupedHistory).onConflictDoUpdate({
          target: queryHistory.id,
          set: {
            connectionId: sql`excluded.connection_id`, query: sql`excluded.query`,
            executedAt: sql`excluded.executed_at`, duration: sql`excluded.duration`,
            status: sql`excluded.status`, error: sql`excluded.error`,
            rowsCount: sql`excluded.rows_count`, caller: sql`excluded.caller`,
            executedBy: sql`excluded.executed_by`, executedByName: sql`excluded.executed_by_name`,
          },
        });
      }
    });

    await logHistoryOperation("save", connectionId, {
      savedCount: dedupedHistory.length, success: true,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[rexadb] saveStudioHistory:error", { connectionId, error: errorMessage });
    await logHistoryOperation("error", connectionId, { operation: "save", error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

export async function getStudioTags(connectionId: number, ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { db } = await import("./index");
  const { tags } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const tagsData = await db.select().from(tags).where(eq(tags.connectionId, connectionId));
    return { success: true, data: tagsData };
  } catch (error) {
    console.error("Failed to fetch studio tags:", error);
    return { success: false, error: "Failed to fetch studio tags" };
  }
}

export async function saveStudioTags(connectionId: number, tagsList: any[], ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { tags } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    await runCoreTransaction("saveStudioTags", async (db) => {
      await db.delete(tags).where(eq(tags.connectionId, connectionId));
      if (tagsList.length > 0) {
        await db.insert(tags).values(tagsList.map(t => ({ ...t, connectionId })));
      }
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save tags:", error);
    return { success: false };
  }
}

export async function getStudioTableTags(connectionId: number, ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { db } = await import("./index");
  const { tableTags } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const tableTagsData = await db.select().from(tableTags).where(eq(tableTags.connectionId, connectionId));
    return {
      success: true, data: tableTagsData.reduce((acc: any, curr: any) => {
        if (!acc[curr.tableName]) acc[curr.tableName] = [];
        acc[curr.tableName].push(curr.tagName);
        return acc;
      }, {})
    };
  } catch (error) {
    console.error("Failed to fetch studio table tags:", error);
    return { success: false, error: "Failed to fetch studio table tags" };
  }
}

export async function saveStudioTableTags(connectionId: number, tableTagsMap: Record<string, string[]>, ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { tableTags } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const values: any[] = [];
    Object.entries(tableTagsMap).forEach(([tableName, tagNames]) => {
      tagNames.forEach(tagName => { values.push({ connectionId, tableName, tagName }); });
    });
    await runCoreTransaction("saveStudioTableTags", async (db) => {
      await db.delete(tableTags).where(eq(tableTags.connectionId, connectionId));
      if (values.length > 0) {
        await db.insert(tableTags).values(values);
      }
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save table tags:", error);
    return { success: false };
  }
}

export async function getStudioTabs(connectionId: number, ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { db } = await import("./index");
  const { openTabs } = await import("./schema");
  const { eq, asc } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const tabsData = await db.select().from(openTabs).where(eq(openTabs.connectionId, connectionId)).orderBy(asc(openTabs.order));
    const scopedPrefix = `c${connectionId}:`;
    const decodedTabs = tabsData.map((tab: any) => ({
      ...tab,
      id: typeof tab.id === "string" && tab.id.startsWith(scopedPrefix) ? tab.id.slice(scopedPrefix.length) : tab.id,
    }));
    return { success: true, data: decodedTabs };
  } catch (error) {
    console.error("Failed to fetch studio tabs:", error);
    return { success: false, error: "Failed to fetch studio tabs" };
  }
}

export async function saveStudioTabs(connectionId: number, tabsList: any[], ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { openTabs } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    await runCoreTransaction("saveStudioTabs", async (db) => {
      await db.delete(openTabs).where(eq(openTabs.connectionId, connectionId));
      if (tabsList.length > 0) {
        await db.insert(openTabs).values(
          tabsList.map((t, i) => ({ ...t, id: `c${connectionId}:${t.id}`, connectionId, order: i }))
        );
      }
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save tabs:", error);
    return { success: false, error: String((error as Error)?.message || error || "Failed to save tabs") };
  }
}

export async function getStudioSettings(connectionId: number, ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { db } = await import("./index");
  const { connectionSettings } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const settingsData = await db.select().from(connectionSettings).where(eq(connectionSettings.connectionId, connectionId));
    return { success: true, data: settingsData[0] || null };
  } catch (error) {
    console.error("Failed to fetch studio settings:", error);
    return { success: false, error: "Failed to fetch studio settings" };
  }
}

export async function getStudioBootstrap(
  connectionId: number,
  requestedSchema: string | null | undefined,
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { db } = await import("./index");
  const { connections, connectionSettings, openTabs } = await import("./schema");
  const { eq, asc, sql } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);

    const cols = await db.all<{ name: string }>(sql`PRAGMA table_info(connection_settings)`);
    const hasVimMode = cols.some((c) => c.name === "vim_mode");
    if (!hasVimMode) {
      await db.run(sql`ALTER TABLE connection_settings ADD COLUMN vim_mode INTEGER DEFAULT 0`);
    }

    const [connectionRows, tabsRows, settingsRows] = await Promise.all([
      db.select().from(connections).where(eq(connections.id, connectionId)).limit(1),
      db.select().from(openTabs).where(eq(openTabs.connectionId, connectionId)).orderBy(asc(openTabs.order)),
      db.select().from(connectionSettings).where(eq(connectionSettings.connectionId, connectionId)).limit(1),
    ]);

    const connection = connectionRows[0] || null;
    const settings = settingsRows[0] || null;
    const scopedPrefix = `c${connectionId}:`;
    const tabs = tabsRows.map((tab: any) => ({
      ...tab,
      id: typeof tab.id === "string" && tab.id.startsWith(scopedPrefix) ? tab.id.slice(scopedPrefix.length) : tab.id,
    }));

    if (!connection) {
      return { success: true, data: { connection: null, tabs, settings, schemas: [] as string[], selectedSchema: null as string | null, tables: [] as string[] } };
    }

    const cachedSchemas = await getCachedSchemasSnapshot(connection.connectionString, ensureCoreTables);
    const activeTabId = settings?.activeTabId ? String(settings.activeTabId) : null;
    const activeTab = activeTabId ? tabs.find((tab: any) => String(tab.id) === activeTabId) : null;
    const fallbackSchema = cachedSchemas.includes("public") ? "public" : (cachedSchemas[0] || null);
    const selectedSchema = requestedSchema && cachedSchemas.includes(requestedSchema)
      ? requestedSchema
      : (activeTab?.schema && cachedSchemas.includes(activeTab.schema) ? activeTab.schema : fallbackSchema);
    const cachedTables = selectedSchema
      ? await getCachedTablesSnapshot(connection.connectionString, selectedSchema, ensureCoreTables)
      : [];

    return { success: true, data: { connection, tabs, settings, schemas: cachedSchemas, selectedSchema, tables: cachedTables } };
  } catch (error) {
    console.error("Failed to fetch studio bootstrap:", error);
    return { success: false, error: "Failed to fetch studio bootstrap" };
  }
}

export async function getStudioDashboards(connectionId: number, ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { db } = await import("./index");
  const { dashboardState } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const rows = await db.select().from(dashboardState).where(eq(dashboardState.connectionId, connectionId)).limit(1);
    const row = rows[0];
    if (!row) return { success: true, data: { dashboards: [], folders: [] } };
    const dashboards = JSON.parse(row.dashboardsJson || "[]");
    const folders = JSON.parse(row.foldersJson || "[]");
    return { success: true, data: { dashboards: Array.isArray(dashboards) ? dashboards : [], folders: Array.isArray(folders) ? folders : [] } };
  } catch (error) {
    console.error("Failed to fetch studio dashboards:", error);
    return { success: false, error: "Failed to fetch studio dashboards" };
  }
}

export async function saveStudioDashboards(
  connectionId: number,
  payload: { dashboards?: any[]; folders?: any[] },
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const dashboards = Array.isArray(payload?.dashboards) ? payload.dashboards : [];
    const folders = Array.isArray(payload?.folders) ? payload.folders : [];
    const updatedAt = Date.now();
    await db.run(sql`
      INSERT INTO dashboard_state (connection_id, dashboards_json, folders_json, updated_at)
      VALUES (${connectionId}, ${JSON.stringify(dashboards)}, ${JSON.stringify(folders)}, ${updatedAt})
      ON CONFLICT(connection_id) DO UPDATE SET
        dashboards_json = excluded.dashboards_json, folders_json = excluded.folders_json, updated_at = excluded.updated_at
    `);
    return { success: true };
  } catch (error) {
    console.error("Failed to save studio dashboards:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function saveStudioSettings(
  connectionId: number,
  settings: any,
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const payload = {
      activeTabId: settings?.activeTabId ?? null,
      sidebarSortMode: settings?.sidebarSortMode ?? "alphabetical",
      sidebarView: settings?.sidebarView ?? "tables",
      keybindings: settings?.keybindings ?? null,
      searchSettings: settings?.searchSettings ?? null,
      executionMode: settings?.executionMode ?? "review",
      sidebarBehavior: settings?.sidebarBehavior ?? "expandable",
      rowSpacing: settings?.rowSpacing ?? "relaxed",
      alternatingRowColors: settings?.alternatingRowColors ? 1 : 0,
      editorFontSize: settings?.editorFontSize ?? "12px",
      sqlEditorEngine: settings?.sqlEditorEngine ?? "custom",
      editorThemeId: settings?.editorThemeId ?? "auto",
      customEditorThemes: settings?.customEditorThemes ?? null,
      tuiMode: settings?.tuiMode ? 1 : 0,
      tuiTheme: settings?.tuiTheme ?? "auto",
      commandMenuSections: settings?.commandMenuSections ?? null,
      splitView: settings?.splitView ?? null,
      agentProvider: settings?.agentProvider ?? "openai",
      agentModel: settings?.agentModel ?? null,
      agentApiKey: settings?.agentApiKey ?? null,
    };
    await withSqliteBusyRetry(async () => {
      await db.run(sql`
        INSERT INTO connection_settings (
          connection_id, active_tab_id, sidebar_sort_mode, sidebar_view, sidebar_behavior,
          keybindings, search_settings, execution_mode, row_spacing, alternating_row_colors,
          editor_font_size, sql_editor_engine, editor_theme_id, custom_editor_themes,
          tui_mode, tui_theme, command_menu_sections, split_view,
          agent_provider, agent_model, agent_api_key
        ) VALUES (
          ${connectionId}, ${payload.activeTabId}, ${payload.sidebarSortMode}, ${payload.sidebarView}, ${payload.sidebarBehavior},
          ${payload.keybindings}, ${payload.searchSettings}, ${payload.executionMode}, ${payload.rowSpacing}, ${payload.alternatingRowColors},
          ${payload.editorFontSize}, ${payload.sqlEditorEngine}, ${payload.editorThemeId}, ${payload.customEditorThemes},
          ${payload.tuiMode}, ${payload.tuiTheme}, ${payload.commandMenuSections}, ${payload.splitView},
          ${payload.agentProvider}, ${payload.agentModel}, ${payload.agentApiKey}
        ) ON CONFLICT(connection_id) DO UPDATE SET
          active_tab_id = excluded.active_tab_id, sidebar_sort_mode = excluded.sidebar_sort_mode,
          sidebar_view = excluded.sidebar_view, sidebar_behavior = excluded.sidebar_behavior,
          keybindings = excluded.keybindings, search_settings = excluded.search_settings,
          execution_mode = excluded.execution_mode, row_spacing = excluded.row_spacing,
          alternating_row_colors = excluded.alternating_row_colors, editor_font_size = excluded.editor_font_size,
          sql_editor_engine = excluded.sql_editor_engine, editor_theme_id = excluded.editor_theme_id,
          custom_editor_themes = excluded.custom_editor_themes, tui_mode = excluded.tui_mode,
          tui_theme = excluded.tui_theme, command_menu_sections = excluded.command_menu_sections,
          split_view = excluded.split_view, agent_provider = excluded.agent_provider,
          agent_model = excluded.agent_model, agent_api_key = excluded.agent_api_key
      `);
    }, "saveStudioSettings");
    return { success: true };
  } catch (error) {
    console.error("Failed to save settings:", error);
    return { success: false, error: String((error as Error)?.message || error || "Failed to save settings") };
  }
}

function computeAnalytics(rows: Array<{ status: string; executedAt: number; duration: number; query: string }>) {
  const { totalQueries, successCount, errorCount, successRate } = computeBasicStats(rows);
  const avgDuration = totalQueries > 0
    ? Math.round(rows.reduce((sum, r) => sum + r.duration, 0) / totalQueries)
    : 0;
  const totalDuration = rows.reduce((sum, r) => sum + r.duration, 0);
  const queriesByDay = computeQueriesByDay(rows);
  const lastActive = rows.length > 0 ? rows[0].executedAt : null;
  const totalSessions = rows.length;
  const topQueries = computeTopQueries(rows);

  // Compute peak day from queriesByDay
  let peakDay: { date: string; count: number } | null = null;
  let peakCount = 0;
  for (const day of queriesByDay) {
    if (day.count > peakCount) {
      peakCount = day.count;
      peakDay = { date: day.date, count: day.count };
    }
  }

  return {
    totalQueries, successCount, errorCount, successRate,
    avgDuration, totalDuration, queriesByDay, lastActive,
    totalSessions, topQueries, peakDay,
  };
}

function filterByTimeRange<T extends { executedAt: number }>(
  rows: T[],
  range: string,
): T[] {
  const now = Date.now();
  const ms: Record<string, number> = {
    "1H": 60 * 60 * 1000,
    "4H": 4 * 60 * 60 * 1000,
    "24H": 24 * 60 * 60 * 1000,
    "72H": 72 * 60 * 60 * 1000,
    "7D": 7 * 24 * 60 * 60 * 1000,
    "30D": 30 * 24 * 60 * 60 * 1000,
  };
  const offset = ms[range];
  return offset ? rows.filter((r) => r.executedAt >= now - offset) : rows;
}

export async function getConnectionAnalytics(
  connectionId: number,
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
  range?: string,
) {
  const { db } = await import("./index");
  const { queryHistory, connections, snippets } = await import("./schema");
  const { eq, desc, sql, and } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);

    const rows = await db
      .select()
      .from(queryHistory)
      .where(eq(queryHistory.connectionId, connectionId))
      .orderBy(desc(queryHistory.executedAt));

    const filteredRows = range ? filterByTimeRange(rows, range) : rows;

    const {
      totalQueries, successCount, errorCount, successRate,
      avgDuration, totalDuration, queriesByDay, lastActive,
      totalSessions, topQueries, peakDay,
    } = computeAnalytics(filteredRows);

    const recentQueries = filteredRows.slice(0, 50).map((r) => ({
      id: String(r.id),
      query: r.query,
      executedAt: r.executedAt,
      duration: r.duration,
      status: r.status as string,
      error: (r as any).error ?? undefined,
      executedBy: (r as any).executedBy ?? undefined,
      executedByName: (r as any).executedByName ?? undefined,
    }));

    const errorsByDayMap = new Map<string, number>();
    for (const r of rows) {
      if (String(r.status).toLowerCase() === "error") {
        const d = new Date(r.executedAt);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        errorsByDayMap.set(dateStr, (errorsByDayMap.get(dateStr) || 0) + 1);
      }
    }
    const errorsByDay = Array.from(errorsByDayMap.entries())
      .map(([date, errors]) => ({ date, errors }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const contributorsMap = new Map<string, { id: string; name: string; queryCount: number }>();
    for (const r of filteredRows) {
      if (r.executedBy) {
        const id = r.executedBy;
        const existing = contributorsMap.get(id);
        if (existing) {
          existing.queryCount++;
        } else {
          contributorsMap.set(id, { id, name: r.executedByName || id, queryCount: 1 });
        }
      }
    }
    const contributors = Array.from(contributorsMap.values()).sort((a, b) => b.queryCount - a.queryCount);

    const snippetRows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(snippets)
      .where(eq(snippets.connectionId, connectionId));
    const totalSnippets = Number(snippetRows[0]?.count || 0);

    return {
      success: true,
      data: {
        totalQueries,
        successRate,
        queriesByDay,
        statusDistribution: { success: successCount, error: errorCount },
        topQueries,
        avgDuration,
        mostQueriedTables: [],
        contributors,
        connectionActivity: { lastActive, totalSessions },
        queriesByConnection: [],
        totalDuration,
        totalSnippets,
        peakDay,
        recentQueries,
        errorsByDay,
      },
    };
  } catch (error) {
    console.error("Failed to fetch connection analytics:", error);
    return { success: false, error: "Failed to fetch connection analytics" };
  }
}

export async function getUserAnalytics(
  ensureCoreTables: () => Promise<void>,
) {
  const { db } = await import("./index");
  const { queryHistory, connections, snippets } = await import("./schema");
  const { desc, sql } = await import("drizzle-orm");

  try {
    await ensureCoreTables();

    const allRows = await db
      .select()
      .from(queryHistory)
      .orderBy(desc(queryHistory.executedAt));

    const {
      totalQueries, successCount, errorCount, successRate,
      avgDuration, totalDuration, queriesByDay, lastActive,
      totalSessions, topQueries, peakDay,
    } = computeAnalytics(allRows);

    const connRows = await db.select().from(connections);
    const totalConnections = connRows.length;

    const connectionsOverview = connRows.map((c) => {
      const connQueries = allRows.filter((r) => r.connectionId === c.id);
      return {
        id: c.id,
        name: c.name,
        type: String(c.connectionString?.match(/^([a-zA-Z0-9+.-]+):/)?.[1] || "postgresql"),
        totalQueries: connQueries.length,
      };
    });

    const queriesByDayByConnection = connRows.map((c) => {
      const connQueries = allRows.filter((r) => r.connectionId === c.id);
      const byDay = new Map<string, number>();
      for (const r of connQueries) {
        const d = new Date(r.executedAt);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        byDay.set(dateStr, (byDay.get(dateStr) || 0) + 1);
      }
      return {
        connectionId: c.id,
        connectionName: c.name,
        queriesByDay: Array.from(byDay.entries())
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    });

    const snippetResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(snippets);
    const totalSnippets = Number(snippetResult[0]?.count || 0);

    return {
      success: true,
      data: {
        totalQueries,
        successRate,
        queriesByDay,
        statusDistribution: { success: successCount, error: errorCount },
        topQueries,
        avgDuration,
        mostQueriedTables: [],
        connectionActivity: { lastActive, totalSessions },
        queriesByConnection: connectionsOverview.map((c) => ({
          connectionId: c.id,
          totalQueries: c.totalQueries,
        })),
        totalDuration,
        totalSnippets,
        peakDay,
        totalConnections,
        connectionsOverview,
        queriesByDayByConnection,
        contributors: [],
      },
    };
  } catch (error) {
    console.error("Failed to fetch user analytics:", error);
    return { success: false, error: "Failed to fetch user analytics" };
  }
}
