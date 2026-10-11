import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ToolbarSelectionActions } from "./toolbar/toolbar-selection-actions";
import { ToolbarFilterSort, stripLeadingWhereKeyword } from "./toolbar/toolbar-filter-sort";
import { ToolbarGlobalActions } from "./toolbar/toolbar-global-actions";
import { SavedTableViews } from "./saved-table-views";
import { ToolbarLayout } from "./toolbar/toolbar-layout";
import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutTable01Icon } from "@hugeicons/core-free-icons";
import { Loader2 } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api-base";
import { getGlobalAiSettings } from "@/lib/api/actions-client";
import { readSseStream } from "@/lib/ai/read-sse-stream";
import { formatShortcutForPlatform } from "@/lib/studio/keybindings";
import type { GlobalAiSettings } from "@/lib/api/actions-client";
import type { ConnectionDbType } from "@/lib/db/connection-type";
import type {
  SupabaseAuthUserOption,
  TablePermissionContext,
} from "@/lib/studio/table-permissions";

interface DataTableToolbarProps {
  selectedRows: Set<number>;
  setSelectedRows: (rows: Set<number>) => void;
  exportData: (format: "json" | "csv" | "sql") => void;
  copyData: (format: "json" | "csv" | "sql") => void;
  handleDeleteRows: () => void;
  isDeleting: boolean;
  filterQuery: string;
  setFilterQuery: (query: string) => void;
  sortConfig: Array<{ column: string; direction: "ASC" | "DESC" }>;
  setSortConfig: (
    config: Array<{ column: string; direction: "ASC" | "DESC" }>,
  ) => void;
  refreshTableData: (
    table: string,
    schema: string,
    filter: string,
    sort: Array<{ column: string; direction: "ASC" | "DESC" }>,
  ) => void;
  refreshCurrentTab: () => void;
  selectedTable: string | null;
  selectedSchema: string;
  results: any;
  setIsInsertSheetOpen: (open: boolean) => void;
  loading: boolean;
  fetchingStructure: boolean;
  onOpenRlsPolicies: () => void;
  onEnableRls?: () => Promise<void> | void;
  globalSearchQuery: string;
  setGlobalSearchQuery: (query: string) => void;
  globalSearchScope: "page" | "table";
  setGlobalSearchScope: (scope: "page" | "table") => void;
  supportsWholeTableSearch?: boolean;
  dbType?: ConnectionDbType;
  rlsEnabled?: boolean;
  rlsPolicyCount?: number;
  permissionContext: TablePermissionContext;
  setPermissionContext: (value: TablePermissionContext) => void;
  postgresRoles: string[];
  supabaseAuthUsers: SupabaseAuthUserOption[];
  loadingPermissionOptions?: boolean;
  isPermissionPreview?: boolean;
  hiddenColumns?: string[];
  onToggleColumn?: (columnName: string) => void;
  onShowAllColumns?: () => void;
  tableStructure?: any[];
  connectionString?: string;
  connectionId?: number | null;
}

// ─── Quick filters: `column op value` typed straight into search ───

const QUICK_FILTER_OPS = ["=", "!=", "<>", ">=", "<=", ">", "<", "~"] as const;

function quoteQuickIdentifier(name: string, dbType?: ConnectionDbType): string {
  const raw = String(name || "");
  if (dbType === "mysql" || dbType === "clickhouse") {
    return `\`${raw.replace(/`/g, "``")}\``;
  }
  if (dbType === "mssql") {
    return `[${raw.replace(/]/g, "]]")}]`;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function toQuickLiteral(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/^'([\s\S]*)'$/, "$1").replace(/^"([\s\S]*)"$/, "$1");
  if (!trimmed.length) return "''";
  if (/^null$/i.test(trimmed)) return "NULL";
  if (/^true$/i.test(trimmed)) return "TRUE";
  if (/^false$/i.test(trimmed)) return "FALSE";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}

/** Longest known column that prefixes the text (case-insensitive). */
function matchColumnPrefix(
  text: string,
  columns: string[],
): { column: string; rest: string } | null {
  const lower = text.toLowerCase();
  let best: string | null = null;
  for (const col of columns) {
    if (!col) continue;
    if (lower.startsWith(col.toLowerCase()) && (best === null || col.length > best.length)) {
      best = col;
    }
  }
  if (best === null) return null;
  return { column: best, rest: text.slice(best.length) };
}

/**
 * Parse `column op value` / `column IS [NOT] NULL` into a SQL WHERE clause.
 * Returns null when the text isn't a complete filter.
 */
function parseQuickFilter(
  text: string,
  columns: string[],
  dbType?: ConnectionDbType,
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const matched = matchColumnPrefix(trimmed, columns);
  if (!matched || matched.rest === "" || !/^\s/.test(matched.rest)) return null;
  const column = quoteQuickIdentifier(matched.column, dbType);
  const rest = matched.rest.trim();
  if (!rest) return null;

  const nullMatch = rest.match(/^is\s+(not\s+)?null$/i);
  if (nullMatch) {
    return nullMatch[1] ? `${column} IS NOT NULL` : `${column} IS NULL`;
  }

  const opMatch = rest.match(/^(>=|<=|!=|<>|=|>|<|~)\s*([\s\S]*)$/);
  if (!opMatch) return null;
  const [, op, rawValue] = opMatch;
  if (!rawValue.trim()) return null;
  if (op === "~") {
    const pattern = rawValue
      .trim()
      .replace(/^'([\s\S]*)'$/, "$1")
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/'/g, "''");
    return dbType === "mssql"
      ? `CAST(${column} AS NVARCHAR(MAX)) LIKE '%${pattern}%'`
      : `CAST(${column} AS TEXT) LIKE '%${pattern}%'`;
  }
  const sqlOp = op === "!=" ? "<>" : op;
  return `${column} ${sqlOp} ${toQuickLiteral(rawValue)}`;
}

// ─── AI filter: natural language → WHERE clause via the default agent ───

function pickAiProviderAndModel(settings: GlobalAiSettings): { provider: string; model: string } {
  const providers = settings?.providers && typeof settings.providers === "object" ? settings.providers : {};
  const usable = (id: string) => {
    const c = providers[id];
    return !!c && (id === "ollama" || String(c.apiKey ?? "").trim().length > 0) && Array.isArray(c.models) && c.models.length > 0;
  };
  const defProvider = String(settings?.defaultProvider ?? "").trim();
  const defModel = String(settings?.defaultModel ?? "").trim();
  if (defProvider && usable(defProvider)) {
    const models = providers[defProvider].models;
    if (defModel && models.includes(defModel)) return { provider: defProvider, model: defModel };
    return { provider: defProvider, model: models[0] };
  }
  for (const [id, config] of Object.entries(providers)) {
    if (id === "exa") continue;
    if (usable(id)) return { provider: id, model: config.models[0] };
  }
  throw new Error("Set a default AI provider in AI settings first (Models section).");
}

function extractWhereClause(raw: string): string | null {
  let text = String(raw || "").trim();
  if (!text) return null;
  const fence = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  text = stripLeadingWhereKeyword(text);
  text = text.replace(/;+\s*$/, "").trim();
  if (!text || /^cannot\b/i.test(text)) return null;
  return text;
}

/** Rainbow beam colors borrowed from the AI prompt bar's model-switch sweep. */
const AI_BEAM_CONIC =
  "conic-gradient(from 0deg, transparent 0deg, #ef4444 30deg, #f97316 60deg, #eab308 90deg, #22c55e 130deg, #06b6d4 170deg, #3b82f6 210deg, #a855f7 250deg, transparent 290deg)";

/** Rainbow beam ring — travels the full perimeter of its relative parent. */
function AiBeamRing() {
  return (
    <>
      <style>{`@keyframes ai-beam-rotate { to { transform: rotate(360deg); } }`}</style>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
        style={{
          padding: 1.5,
          WebkitMask:
            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
        }}
      >
        <div className="absolute top-1/2 left-1/2 aspect-square w-[250%] -translate-x-1/2 -translate-y-1/2">
          <div
            className="h-full w-full animate-[ai-beam-rotate_2.6s_linear_infinite]"
            style={{ background: AI_BEAM_CONIC }}
          />
        </div>
      </div>
    </>
  );
}

/** Dialect pinning so the agent emits syntax the engine accepts. */
function dialectRules(dbType?: ConnectionDbType): string {
  switch (dbType) {
    case "mysql":
    case "clickhouse":
      return [
        "- Quote identifiers with backticks: `col`.",
        "- String literals in 'single quotes'. Numbers and booleans unquoted.",
        "- No ILIKE. For fuzzy text match use `col` LIKE '%...%'.",
      ].join("\n");
    case "mssql":
      return [
        "- Quote identifiers with square brackets: [col].",
        "- String literals in 'single quotes'. Use 1/0 instead of TRUE/FALSE.",
        "- No ILIKE. For fuzzy text match use CAST([col] AS NVARCHAR(MAX)) LIKE '%...%'.",
      ].join("\n");
    case "sqlite":
    case "duckdb":
      return [
        '- Quote identifiers with double quotes: "col".',
        "- String literals in 'single quotes'. Numbers unquoted.",
        "- No ILIKE and no backticks. For fuzzy text match use CAST(\"col\" AS TEXT) LIKE '%...%'.",
      ].join("\n");
    default:
      return [
        '- Quote identifiers with double quotes: "col".',
        "- String literals in 'single quotes'. Numbers and TRUE/FALSE unquoted.",
        "- ILIKE is allowed for case-insensitive match, otherwise CAST(\"col\" AS TEXT) LIKE '%...%'.",
      ].join("\n");
  }
}

async function runAgentFilter(opts: {
  text: string;
  schema: string;
  table: string;
  dbType?: ConnectionDbType;
  columns: Array<{ name: string; type: string }>;
  connectionId?: number | null;
  connectionString?: string;
}): Promise<string> {
  const settingsResult = await getGlobalAiSettings();
  const settings = (settingsResult as { success?: boolean; data?: GlobalAiSettings })?.data;
  if (!settingsResult || (settingsResult as { success?: boolean }).success === false || !settings) {
    throw new Error("Could not load AI settings.");
  }
  const { provider, model } = pickAiProviderAndModel(settings);

  const columnLines = opts.columns.map((c) => `- ${c.name} (${c.type})`).join("\n");
  const prompt = [
    "You are building a SQL WHERE clause filter for a database table UI.",
    `Database engine: ${opts.dbType || "postgres"}. Follow that engine's syntax exactly.`,
    `Table: "${opts.schema}"."${opts.table}"`,
    "Columns:",
    columnLines,
    `User request: "${opts.text}"`,
    "Rules:",
    "- Reply with ONLY the WHERE condition, no markdown fences, no explanation.",
    "- NEVER include the word WHERE itself, and never return a SELECT statement.",
    "- Use ONLY the columns listed above.",
    dialectRules(opts.dbType),
    "- For fuzzy text match follow the dialect rule above.",
    '- If the request cannot be expressed as a filter, reply with exactly: CANNOT',
  ].join("\n");

  const response = await apiFetch("/api/agent/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: `ai-filter-${Date.now()}`,
      provider,
      model,
      permissionMode: "schema_only",
      prompt,
      connectionId: opts.connectionId ?? null,
      connectionString: opts.connectionString || "",
      dbType: opts.dbType || "postgres",
      selectedNamespace: opts.schema,
      history: [],
      lightSchemaContext: [
        {
          schema: opts.schema,
          table: opts.table,
          columns: opts.columns,
        },
      ],
      lightDashboardContext: [],
      lightWorkflowContext: { existing: [], current: null },
    }),
  });

  if (!response.ok) {
    let message = `Server error (${response.status})`;
    try {
      const payload = await response.json();
      if (payload && typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      }
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("Failed to start AI filter stream.");

  let text = "";
  const reader = response.body.getReader();
  for await (const event of readSseStream(reader)) {
    if (event.type === "assistant_delta") text += event.message;
    else if (event.type === "assistant_done" && event.message) text = event.message;
    else if (event.type === "error") throw new Error(event.message || "AI filter failed.");
  }

  const clause = extractWhereClause(text);
  if (!clause) throw new Error("The agent could not build a filter from that text.");
  return clause;
}

export function DataTableToolbar(props: DataTableToolbarProps) {
  const { selectedRows } = props;
  // Shared by both bar states — either one can kick off an AI filter.
  const [aiBusy, setAiBusy] = useState(false);

  const columnList = props.tableStructure?.length
    ? props.tableStructure.map((c: any) => ({
        name: c.column_name || c.name,
        data_type: c.data_type,
        type: c.type,
        udt_name: c.udt_name,
      }))
    : (props.results?.fields ?? []);

  const tableColumns: Array<{ name: string; type: string }> = columnList
    .map((c: any) => ({
      name: String(c?.name ?? ""),
      type: String(c?.data_type ?? c?.type ?? c?.udt_name ?? "unknown"),
    }))
    .filter((c: { name: string }) => c.name);

  const toolbarGlobalActions = (
    <ToolbarGlobalActions
      setIsInsertSheetOpen={props.setIsInsertSheetOpen}
      selectedTable={props.selectedTable}
      refreshCurrentTab={props.refreshCurrentTab}
      loading={props.loading}
      fetchingStructure={props.fetchingStructure}
      onOpenRlsPolicies={props.onOpenRlsPolicies}
      onEnableRls={props.onEnableRls}
      dbType={props.dbType}
      rlsEnabled={props.rlsEnabled}
      rlsPolicyCount={props.rlsPolicyCount}
      permissionContext={props.permissionContext}
      onPermissionContextChange={props.setPermissionContext}
      postgresRoles={props.postgresRoles}
      supabaseAuthUsers={props.supabaseAuthUsers}
      loadingPermissionOptions={props.loadingPermissionOptions}
      connectionString={props.connectionString}
    />
  );

  const ColumnsDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="font-normal dark:border-white/15 dark:bg-white/[0.02]">
          <HugeiconsIcon icon={LayoutTable01Icon} className="w-3.5 h-3.5" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs tracking-wider text-muted-foreground/70">
          Visible Columns
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columnList.map((col: any) => (
          <DropdownMenuCheckboxItem
            key={col.name}
            checked={!props.hiddenColumns?.includes(col.name)}
            onCheckedChange={() => props.onToggleColumn?.(col.name)}
            className="text-xs"
          >
            {col.name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <button
          onClick={() => props.onShowAllColumns?.()}
          className="w-full px-2 py-1.5 text-xs text-left text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors rounded-lg"
        >
          Show all columns
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const toolbarItems = [
    { id: "filter", label: "Filter and sort", content: <><ToolbarFilterSort
      filterQuery={props.filterQuery} setFilterQuery={props.setFilterQuery}
      sortConfig={props.sortConfig} setSortConfig={props.setSortConfig}
      refreshTableData={props.refreshTableData} selectedTable={props.selectedTable}
      selectedSchema={props.selectedSchema} results={props.results} dbType={props.dbType}
      globalSearchQuery={props.globalSearchQuery} setGlobalSearchQuery={props.setGlobalSearchQuery}
      setGlobalSearchScope={props.setGlobalSearchScope}
    /></> },
    { id: "views", label: "Saved views", content: <SavedTableViews
      connectionString={props.connectionString} table={props.selectedTable}
      schema={props.selectedSchema} filter={props.filterQuery} sort={props.sortConfig}
      onApply={(filter, sort) => {
        props.setFilterQuery(filter); props.setSortConfig(sort);
        if (props.selectedTable) props.refreshTableData(props.selectedTable, props.selectedSchema, filter, sort);
      }}
    /> },
    { id: "columns", label: "Columns", content: ColumnsDropdown },
    { id: "actions", label: "Table actions", content: toolbarGlobalActions },
  ];

  // The toolbar itself is one search bar: a full-width field that owns
  // the row, with scope + actions docked inside it. Clicking anywhere
  // in the bar focuses search.
  const searchBar = (
    <UnifiedSearchBar
      globalSearchQuery={props.globalSearchQuery}
      setGlobalSearchQuery={props.setGlobalSearchQuery}
      selectedTable={props.selectedTable}
      selectedSchema={props.selectedSchema}
      tableColumns={tableColumns}
      filterQuery={props.filterQuery}
      setFilterQuery={props.setFilterQuery}
      sortConfig={props.sortConfig}
      refreshTableData={props.refreshTableData}
      dbType={props.dbType}
      connectionId={props.connectionId}
      connectionString={props.connectionString}
      aiBusy={aiBusy}
      setAiBusy={setAiBusy}
    >
      <ToolbarLayout items={toolbarItems} connectionString={props.connectionString} />
    </UnifiedSearchBar>
  );

  const selectionSearchBar = (
    <UnifiedSearchBar
      globalSearchQuery={props.globalSearchQuery}
      setGlobalSearchQuery={props.setGlobalSearchQuery}
      selectedTable={props.selectedTable}
      selectedSchema={props.selectedSchema}
      tableColumns={tableColumns}
      filterQuery={props.filterQuery}
      setFilterQuery={props.setFilterQuery}
      sortConfig={props.sortConfig}
      refreshTableData={props.refreshTableData}
      dbType={props.dbType}
      connectionId={props.connectionId}
      connectionString={props.connectionString}
      aiBusy={aiBusy}
      setAiBusy={setAiBusy}
    >
      <ToolbarLayout items={toolbarItems} connectionString={props.connectionString} />
    </UnifiedSearchBar>
  );

  return (
    <div className="relative border-b border-border bg-studio-bg h-12 shrink-0 overflow-hidden">
      {/* Default State */}
      <div
        className={cn(
          "flex items-center px-4 h-full w-full transition-all duration-300 ease-in-out absolute inset-0 gap-2",
          selectedRows.size > 0
            ? "-translate-y-full opacity-0 pointer-events-none"
            : "translate-y-0 opacity-100",
        )}
      >
        {searchBar}
      </div>

      {/* Selection State */}
      <div
        className={cn(
          "flex items-center px-4 h-full w-full transition-all duration-300 ease-in-out absolute inset-0 gap-2",
          selectedRows.size > 0
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <ToolbarSelectionActions
          selectedRows={props.selectedRows}
          setSelectedRows={props.setSelectedRows}
          exportData={props.exportData}
          copyData={props.copyData}
          handleDeleteRows={props.handleDeleteRows}
          isDeleting={props.isDeleting}
          deleteDisabled={props.isPermissionPreview}
        />

        <div className="flex flex-1 items-center gap-2">
          {selectionSearchBar}
        </div>
      </div>
      {aiBusy && <AiBeamRing />}
    </div>
  );
}

function UnifiedSearchBar({
  globalSearchQuery,
  setGlobalSearchQuery,
  selectedTable,
  selectedSchema,
  tableColumns,
  filterQuery,
  setFilterQuery,
  sortConfig,
  refreshTableData,
  dbType,
  connectionId,
  connectionString,
  aiBusy,
  setAiBusy,
  children,
}: {
  globalSearchQuery: string;
  setGlobalSearchQuery: (query: string) => void;
  selectedTable: string | null;
  selectedSchema: string;
  tableColumns: Array<{ name: string; type: string }>;
  filterQuery: string;
  setFilterQuery: (query: string) => void;
  sortConfig: Array<{ column: string; direction: "ASC" | "DESC" }>;
  refreshTableData: (
    table: string,
    schema: string,
    filter: string,
    sort: Array<{ column: string; direction: "ASC" | "DESC" }>,
  ) => void;
  dbType?: ConnectionDbType;
  connectionId?: number | null;
  connectionString?: string;
  aiBusy: boolean;
  setAiBusy: (busy: boolean) => void;
  children: ReactNode;
}) {
  const columns = tableColumns.map((c) => c.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Filter assist never pops on its own — only via Cmd/Ctrl+F or the hint.
  const [assistOpen, setAssistOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  // Pixel offset where the hint chips ride — just past the text/placeholder.
  const [hintLeft, setHintLeft] = useState<number | null>(null);
  // Platform-aware shortcut labels (⌘/Ctrl, ↩/Enter).
  const filterKeys = formatShortcutForPlatform("Cmd+F");
  const aiKeys = formatShortcutForPlatform("Cmd+Return");
  const placeholderText = `Search all values in ${selectedTable ?? "table"}...`;

  // Intentionally runs after every render: the hint must track the text
  // width as the user types. The equality guard prevents update loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const input = inputRef.current;
    const measure = measureRef.current;
    if (!input || !measure) return;
    const end = measure.scrollWidth + 8;
    const next = Math.max(0, Math.min(end, input.clientWidth - 264));
    setHintLeft((prev) => (prev === next ? prev : next));
  });

  // Suggestion items for the current text: columns first, then operators.
  const suggestItems: Array<{ kind: "column" | "operator"; label: string; apply: string }> = (() => {
    if (!assistOpen) return [];
    const v = globalSearchQuery;
    if (v.trim() === "") return columns.slice(0, 8).map((c) => ({ kind: "column" as const, label: c, apply: `${c} ` }));
    const matched = matchColumnPrefix(v.trim(), columns);
    if (!matched || matched.rest === "" || !/^\s/.test(matched.rest)) {
      const lower = v.toLowerCase();
      return columns
        .filter((c) => c.toLowerCase().startsWith(lower))
        .slice(0, 8)
        .map((c) => ({ kind: "column" as const, label: c, apply: `${c} ` }));
    }
    const opPart = matched.rest.trim();
    if (opPart === "") {
      return QUICK_FILTER_OPS.map((op) => ({
        kind: "operator" as const,
        label: op === "~" ? "~ contains" : op,
        apply: `${matched.column} ${op} `,
      }));
    }
    // Complete operator alone → user is about to type a value, stay quiet.
    if ((QUICK_FILTER_OPS as readonly string[]).includes(opPart)) return [];
    return QUICK_FILTER_OPS.filter((op) => op.startsWith(opPart))
      .map((op) => ({
        kind: "operator" as const,
        label: op === "~" ? "~ contains" : op,
        apply: `${matched.column} ${op} `,
      }));
  })();

  const showSuggest = assistOpen && focused && suggestItems.length > 0;
  const clampedIdx = suggestItems.length === 0 ? 0 : Math.min(activeIdx, suggestItems.length - 1);

  const openAssist = () => {
    setAssistOpen(true);
    setActiveIdx(0);
    inputRef.current?.focus();
  };

  const applySuggestion = (item: { apply: string }) => {
    setGlobalSearchQuery(item.apply);
    setActiveIdx(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = item.apply.length;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const createFilterFromSearch = (): boolean => {
    const clause = parseQuickFilter(globalSearchQuery, columns, dbType);
    if (!clause || !selectedTable) return false;
    const next = filterQuery.trim() ? `${filterQuery} AND (${clause})` : clause;
    setFilterQuery(next);
    refreshTableData(selectedTable, selectedSchema, next, sortConfig);
    setGlobalSearchQuery("");
    setAssistOpen(false);
    toast.success(`Filter added: ${clause}`);
    inputRef.current?.blur();
    return true;
  };

  const createAiFilter = async () => {
    const text = globalSearchQuery.trim();
    if (!text || aiBusy || !selectedTable) return;
    setAiBusy(true);
    setAssistOpen(false);
    try {
      const clause = await runAgentFilter({
        text,
        schema: selectedSchema,
        table: selectedTable,
        dbType,
        columns: tableColumns,
        connectionId,
        connectionString,
      });
      const next = filterQuery.trim() ? `${filterQuery} AND (${clause})` : clause;
      setFilterQuery(next);
      refreshTableData(selectedTable, selectedSchema, next, sortConfig);
      setGlobalSearchQuery("");
      toast.success(`AI filter added: ${clause}`);
      inputRef.current?.blur();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI filter failed.");
    } finally {
      setAiBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openAssist();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void createAiFilter();
      return;
    }
    if (showSuggest) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((prev) => (prev + 1) % suggestItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((prev) => (prev - 1 + suggestItems.length) % suggestItems.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggestItems[clampedIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAssistOpen(false);
        return;
      }
    } else if (e.key === "Escape") {
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Enter") {
      // Tab/click completes suggestions; Enter creates a filter when the
      // text is a complete `column op value`, otherwise just blurs
      // (plain text keeps working as live search).
      if (!createFilterFromSearch()) inputRef.current?.blur();
    }
  };

  return (
    <Popover open={showSuggest} onOpenChange={(o) => { if (!o) setAssistOpen(false); }}>
      <PopoverAnchor asChild>
        <div
          ref={barRef}
          onClick={(e) => {
            // Portal clicks (filter/sort/columns panels) bubble through the
            // React tree but are NOT DOM-contained in the bar — ignore them,
            // or focus theft closes the panel they came from.
            if (!barRef.current?.contains(e.target as Node)) return;
            // Clicks on buttons/inputs inside the bar keep their own behavior.
            const el = e.target as HTMLElement | null;
            if (
              el?.closest?.(
                "button, input, select, textarea, a, [role='menu'], [role='menuitem'], [role='option'], [role='listbox'], [role='dialog'], [contenteditable='true']",
              )
            ) {
              return;
            }
            inputRef.current?.focus();
          }}
          className="relative flex h-full min-w-0 flex-1 cursor-text items-center bg-background"
        >
          <input
            ref={inputRef}
            value={globalSearchQuery}
            onChange={(e) => {
              setGlobalSearchQuery(e.target.value);
              setActiveIdx(0);
            }}
            onFocus={() => setFocused(true)}
            onScroll={() => {
              const input = inputRef.current;
              const measure = measureRef.current;
              if (!input || !measure) return;
              const end = measure.scrollWidth - input.scrollLeft + 8;
              setHintLeft(Math.max(0, Math.min(end, input.clientWidth - 264)));
            }}
            onBlur={() => {
              window.setTimeout(() => {
                setFocused(false);
                setAssistOpen(false);
              }, 120);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholderText}
            className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {/* Hidden mirror of the text/placeholder — positions the hint. */}
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute top-0 left-0 max-w-none text-sm whitespace-pre"
          >
            {globalSearchQuery || placeholderText}
          </span>
          {hintLeft !== null && focused && (
            <div
              style={{ left: hintLeft }}
              className="absolute top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-1"
            >
              <button
                type="button"
                title={`Open filter autocomplete (${filterKeys})`}
                aria-label="Open filter autocomplete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (assistOpen) setAssistOpen(false);
                  else openAssist();
                }}
                className="flex shrink-0 items-center gap-1 rounded border border-border bg-muted/40 px-1 py-0.5 font-mono text-[10px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
              >
                {filterKeys} for filtering
              </button>
              <button
                type="button"
                title={`Create a filter with the default AI agent (${aiKeys})`}
                aria-label="Create an AI filter"
                disabled={aiBusy || !globalSearchQuery.trim()}
                onClick={(e) => {
                  e.stopPropagation();
                  void createAiFilter();
                }}
                className="flex shrink-0 items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1 py-0.5 font-mono text-[10px] whitespace-nowrap text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                {aiKeys} for AI filter
              </button>
            </div>
          )}
          <div className="flex min-w-0 shrink-0 items-center">{children}</div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="-ml-4 w-[calc(var(--radix-popover-trigger-width)+2rem)] rounded-t-none rounded-b-lg border-x-0 border-t-0 bg-background p-1"
      >
        <div className="max-h-56 overflow-y-auto">
          {suggestItems.map((item, idx) => (
            <button
              key={`${item.kind}-${item.label}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySuggestion(item)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                idx === clampedIdx ? "bg-accent text-accent-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[10px]",
                  item.kind === "column"
                    ? "border-border bg-muted/40 text-foreground"
                    : "border-primary/30 bg-primary/10 text-primary",
                )}
              >
                {item.kind === "column" ? "T" : item.label.trim()[0] ?? "="}
              </span>
              <span className="truncate font-mono">{item.label}</span>
              {item.kind === "column" && (
                <span className="ml-auto shrink-0 text-[10px] opacity-60">column</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
          <span className="rounded-none border border-border bg-muted/40 px-1 font-mono">Tab</span> complete
          <span className="rounded-none border border-border bg-muted/40 px-1 font-mono">Enter</span> filter
          <span className="rounded-none border border-border bg-muted/40 px-1 font-mono">Esc</span> close
        </div>
      </PopoverContent>
    </Popover>
  );
}
