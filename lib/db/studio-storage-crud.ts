import { getCachedSchemasSnapshot, getCachedTablesSnapshot } from "./schema-cache-actions";
import { runCoreTransaction, withSqliteBusyRetry, formatDbError } from "./sqlite-helpers";
import { computeBasicStats, computeQueriesByDay, computeTopQueries } from "./analytics-utils";

export async function getStudioHistory(
  connectionId: number,
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { client } = await import("./index");
  const { logHistoryOperation } = await import("./history-logger");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const rows = await client.queryHistory.findMany({
      where: { connectionId },
      include: { connection: true },
      orderBy: { executedAt: "asc" },
    });

    const mappedRows = rows.map((row) => ({
      id: row.id,
      connectionId: row.connectionId,
      query: row.query,
      executedAt: row.executedAt,
      duration: row.duration,
      status: row.status,
      error: row.error,
      rowsCount: row.rowsCount,
      caller: row.caller,
      executedBy: row.executedBy,
      executedByName: row.executedByName,
      connectionName: row.connection?.name ?? null,
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
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    await client.queryHistory.create({
      data: {
        id: entry.id, connectionId, query: entry.query, executedAt: entry.executedAt,
        duration: entry.duration, status: entry.status, error: entry.error ?? null,
        rowsCount: entry.rowsCount ?? null, caller: entry.caller,
        executedBy: entry.executedBy ?? null, executedByName: entry.executedByName ?? null,
      },
      skipDuplicates: true,
    });
    return { success: true };
  } catch (error) {
    console.error("[rexadb] insertHistoryEntry:error", { connectionId, entryId: entry.id, error });
    return { success: false };
  }
}

export async function clearStudioHistory(connectionId: number, ensureCoreTables: () => Promise<void>) {
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await client.queryHistory.deleteMany({ where: { connectionId } });
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
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const tagsData = await client.tags.findMany({ where: { connectionId } });
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
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const tableTagsData = await client.tableTags.findMany({ where: { connectionId } });
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
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const tabsData = await client.openTabs.findMany({
      where: { connectionId },
      orderBy: { order: "asc" },
    });
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
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const settingsData = await client.connectionSettings.findFirst({ where: { connectionId } });
    return { success: true, data: settingsData };
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
  const { client } = await import("./index");
  const { sql } = await import("drizzle-orm");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);

    const cols = await db.all<{ name: string }>(sql`PRAGMA table_info(connection_settings)`);
    const hasVimMode = cols.some((c) => c.name === "vim_mode");
    if (!hasVimMode) {
      await db.run(sql`ALTER TABLE connection_settings ADD COLUMN vim_mode INTEGER DEFAULT 0`);
    }

    const [connectionRows, tabsRows, settingsRow] = await Promise.all([
      client.connections.findMany({ where: { id: connectionId }, take: 1 }),
      client.openTabs.findMany({ where: { connectionId }, orderBy: { order: "asc" } }),
      client.connectionSettings.findFirst({ where: { connectionId } }),
    ]);

    const connection = connectionRows[0] || null;
    const settings = settingsRow || null;
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
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const row = await client.dashboardState.findFirst({ where: { connectionId } });
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
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const dashboards = Array.isArray(payload?.dashboards) ? payload.dashboards : [];
    const folders = Array.isArray(payload?.folders) ? payload.folders : [];
    const updatedAt = Date.now();
    await client.dashboardState.upsert({
      where: { connectionId },
      create: {
        connectionId,
        dashboardsJson: JSON.stringify(dashboards),
        foldersJson: JSON.stringify(folders),
        updatedAt,
      },
      update: {
        dashboardsJson: JSON.stringify(dashboards),
        foldersJson: JSON.stringify(folders),
        updatedAt,
      },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save studio dashboards:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function getStudioNotes(connectionId: number, ensureCoreTables: () => Promise<void>, ensureConnectionExists: (connectionId: number) => Promise<void>) {
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const row = await client.noteState.findFirst({ where: { connectionId } });
    if (!row) return { success: true, data: { notes: [] } };
    const notes = JSON.parse((row as any).notesJson || "[]");
    return { success: true, data: { notes: Array.isArray(notes) ? notes : [] } };
  } catch (error) {
    console.error("Failed to fetch studio notes:", error);
    return { success: false, error: "Failed to fetch studio notes" };
  }
}

export async function saveStudioNotes(
  connectionId: number,
  payload: { notes?: any[] },
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { client } = await import("./index");
  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);
    const notes = Array.isArray(payload?.notes) ? payload.notes : [];
    const updatedAt = Date.now();
    await client.noteState.upsert({
      where: { connectionId },
      create: { connectionId, notesJson: JSON.stringify(notes), updatedAt },
      update: { notesJson: JSON.stringify(notes), updatedAt },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save studio notes:", error);
    return { success: false, error: formatDbError(error) };
  }
}

export async function saveStudioSettings(
  connectionId: number,
  settings: any,
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  const { client } = await import("./index");
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
      alternatingRowColors: Boolean(settings?.alternatingRowColors),
      editorFontSize: settings?.editorFontSize ?? "12px",
      sqlEditorEngine: settings?.sqlEditorEngine ?? "custom",
      editorThemeId: settings?.editorThemeId ?? "auto",
      customEditorThemes: settings?.customEditorThemes ?? null,
      tuiMode: Boolean(settings?.tuiMode),
      tuiTheme: settings?.tuiTheme ?? "auto",
      commandMenuSections: settings?.commandMenuSections ?? null,
      splitView: settings?.splitView ?? null,
      agentProvider: settings?.agentProvider ?? "openai",
      agentModel: settings?.agentModel ?? null,
      agentApiKey: settings?.agentApiKey ?? null,
    };
    await withSqliteBusyRetry(async () => {
      await client.connectionSettings.upsert({
        where: { connectionId },
        create: { connectionId, ...payload } as any,
        update: { ...payload } as any,
      });
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
  const { client } = await import("./index");

  try {
    await ensureCoreTables();
    await ensureConnectionExists(connectionId);

    const rows = await client.queryHistory.findMany({
      where: { connectionId },
      orderBy: { executedAt: "desc" },
    });

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

    const totalSnippets = await client.snippets.count({ where: { connectionId } });

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
  const { client } = await import("./index");

  try {
    await ensureCoreTables();

    const allRows = await client.queryHistory.findMany({
      orderBy: { executedAt: "desc" },
    });

    const {
      totalQueries, successCount, errorCount, successRate,
      avgDuration, totalDuration, queriesByDay, lastActive,
      totalSessions, topQueries, peakDay,
    } = computeAnalytics(allRows);

    const connRows = await client.connections.findMany({});
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

    const totalSnippets = await client.snippets.count({});

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
