"use client";

import React from "react";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  User,
  Cpu,
  Copy,
  Play,
  Search,
  Trash2,
  Table2,
  Rows3,
  Bug,
} from "@/lib/icon-theme/lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { QueryHistory } from "@/lib/studio/types";
import { DataGridAg as DataGrid } from "./data-grid-ag";
import { formatDelimitedValue } from "@/lib/studio/clipboard-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HistoryDebugViewer } from "./history-debug-viewer";
import { clearStudioHistory, getStudioHistory } from "@/lib/api/actions-client";

type CallerFilter = "all" | "system" | "user";
type DisplayMode = "logs" | "cards";

interface QueryHistoryViewProps {
  connectionId?: number;
  connectionName?: string;
  history?: QueryHistory[];
  onRunQuery?: (query: string) => void;
  onClearHistory?: () => void;
}

function extractTableName(query: string) {
  const compact = query.replace(/\s+/g, " ").trim();
  const patterns = [
    /\bfrom\s+(["`\[]?[\w.\-]+["`\]]?)/i,
    /\bjoin\s+(["`\[]?[\w.\-]+["`\]]?)/i,
    /\binto\s+(["`\[]?[\w.\-]+["`\]]?)/i,
    /\bupdate\s+(["`\[]?[\w.\-]+["`\]]?)/i,
    /\btable\s+(["`\[]?[\w.\-]+["`\]]?)/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/["`\[\]]/g, "");
    }
  }

  return "-";
}

function formatAbsoluteTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

export function QueryHistoryView({
  connectionId,
  connectionName,
  history: externalHistory,
  onRunQuery,
  onClearHistory,
}: QueryHistoryViewProps) {
  const [history, setHistory] = React.useState<QueryHistory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [callerFilter, setCallerFilter] = React.useState<CallerFilter>("all");
  const [displayMode, setDisplayMode] = React.useState<DisplayMode>("logs");
  const [selectedLogRows, setSelectedLogRows] = React.useState<Set<number>>(
    new Set(),
  );
  const [logSortConfig, setLogSortConfig] = React.useState<{
    column: string;
    direction: "ASC" | "DESC";
  } | null>(null);
  const [logPage, setLogPage] = React.useState(0);
  const [logPageSize, setLogPageSize] = React.useState(50);
  const [logSelectedCell, setLogSelectedCell] = React.useState<{
    rowIndex: number;
    columnName: string;
  } | null>(null);
  const [logEditingCell, setLogEditingCell] = React.useState<{
    rowIndex: number;
    columnName: string;
  } | null>(null);
  const [logSelectedColumn, setLogSelectedColumn] = React.useState<
    string | null
  >(null);
  const [showDebugDialog, setShowDebugDialog] = React.useState(false);

  // Load directly from SQLite every time connectionId changes — no cache, no state accumulation
  const loadHistory = React.useCallback(async () => {
    if (!connectionId || externalHistory) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getStudioHistory(connectionId);
      if (res.success && res.data) {
        setHistory(
          res.data
            .map((h: any) => ({
              id: h.id,
              query: h.query,
              executedAt: h.executedAt,
              duration: h.duration,
              status: h.status as "success" | "error",
              error: h.error || undefined,
              rowsCount: h.rowsCount ?? undefined,
              caller: h.caller as "user" | "system",
              executedBy: h.executedBy || undefined,
              executedByName: h.executedByName || undefined,
            }))
            .reverse(),
        ); // newest first
      } else {
        setHistory([]);
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId, externalHistory]);

  React.useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleClearHistory = React.useCallback(async () => {
    if (onClearHistory) {
      onClearHistory();
      return;
    }
    if (!connectionId) return;
    await clearStudioHistory(connectionId);
    setHistory([]);
  }, [connectionId, onClearHistory]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const effectiveHistory = externalHistory ?? history;
  const filteredHistory = React.useMemo(() => {
    const lower = search.toLowerCase();
    return effectiveHistory.filter((entry) => {
      const callerMatch =
        callerFilter === "all" ? true : entry.caller === callerFilter;
      const textMatch =
        entry.query.toLowerCase().includes(lower) ||
        (entry.error && entry.error.toLowerCase().includes(lower));
      return callerMatch && textMatch;
    });
  }, [effectiveHistory, callerFilter, search]);

  const sortedHistory = React.useMemo(() => {
    if (!logSortConfig) return filteredHistory;
    const multiplier = logSortConfig.direction === "ASC" ? 1 : -1;
    return [...filteredHistory].sort((a, b) => {
      const getValue = (entry: QueryHistory) => {
        switch (logSortConfig.column) {
          case "time":
            return entry.executedAt;
          case "status":
            return entry.status;
          case "caller":
            return entry.caller;
          case "connection":
            return (
              (entry.connectionName || connectionName || "") as string
            ).toLowerCase();
          case "actor":
            return (
              entry.executedByName ||
              entry.executedBy ||
              ""
            ).toLowerCase();
          case "connection":
            return (entry.connectionName || "").toLowerCase();
          case "table":
            return extractTableName(entry.query).toLowerCase();
          case "query":
            return entry.query.toLowerCase();
          case "error":
            return (entry.error || "").toLowerCase();
          case "duration_ms":
            return entry.duration;
          default:
            return entry.executedAt;
        }
      };
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * multiplier;
      return String(av).localeCompare(String(bv)) * multiplier;
    });
  }, [filteredHistory, logSortConfig]);

  const pagedHistory = React.useMemo(() => {
    const start = logPage * logPageSize;
    return sortedHistory.slice(start, start + logPageSize);
  }, [sortedHistory, logPage, logPageSize]);

  React.useEffect(() => {
    setLogPage(0);
    setSelectedLogRows(new Set());
    setLogSelectedCell(null);
    setLogEditingCell(null);
    setLogSelectedColumn(null);
  }, [search, callerFilter, logPageSize]);

  const logGridResults = React.useMemo(() => {
    const fields = [
      { name: "time" },
      { name: "status" },
      { name: "caller" },
      { name: "connection" },
      { name: "actor" },
      { name: "table" },
      { name: "query" },
      { name: "error" },
      { name: "duration_ms" },
    ];

    const rows = pagedHistory.map((entry) => ({
      __id: entry.id,
      time: formatAbsoluteTime(entry.executedAt),
      status: entry.status === "success" ? "Success" : "Error",
      caller: entry.caller === "user" ? "User" : "System",
      connection: entry.connectionName || connectionName || "-",
      actor: entry.executedByName || entry.executedBy || "-",
      table: extractTableName(entry.query),
      query: entry.query,
      error: entry.error || "",
      duration_ms: entry.duration,
    }));

    return { fields, rows };
  }, [pagedHistory]);

  const renderLogCell = React.useCallback(
    ({
      columnName,
      value,
    }: {
      row: unknown;
      columnName: string;
      value: unknown;
      rowIndex: number;
    }) => {
      if (columnName === "status") {
        const ok = String(value) === "Success";
        return (
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-lg border px-2.5 text-xs font-medium",
              ok
                ? "border-green-500/40 bg-green-500/10 text-green-400"
                : "border-red-500/40 bg-red-500/10 text-red-400",
            )}
          >
            {ok ? "Success" : "Error"}
          </span>
        );
      }

      if (columnName === "caller") {
        const isUser = String(value) === "User";
        return (
          <span
            className={cn(
              "text-xs",
              isUser ? "text-blue-300" : "text-amber-300",
            )}
          >
            {String(value)}
          </span>
        );
      }

      if (columnName === "connection") {
        if (!value || String(value) === "-")
          return <span className="text-xs text-muted-foreground/60">-</span>;
        return (
          <span className="text-xs font-medium text-sky-400">
            {String(value)}
          </span>
        );
      }

      if (columnName === "actor") {
        if (!value || String(value) === "-") {
          return <span className="text-xs text-muted-foreground/60">-</span>;
        }
        return (
          <span className="text-xs text-muted-foreground">{String(value)}</span>
        );
      }

      if (columnName === "error") {
        if (!value) return <span className="text-muted-foreground/40">-</span>;
        return (
          <span
            className="block truncate font-mono text-xs text-red-400"
            title={String(value)}
          >
            {String(value)}
          </span>
        );
      }

      if (columnName === "duration_ms") {
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {String(value)}ms
          </span>
        );
      }

      if (columnName === "query") {
        return (
          <span className="font-mono text-xs text-foreground/90 truncate block">
            {String(value)}
          </span>
        );
      }

      return null;
    },
    [],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-background relative">
      <div className="h-14 border-b border-studio-border flex items-center justify-between px-4 shrink-0 bg-studio-header-bg sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-lg border border-studio-border bg-studio-bg/70 p-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDisplayMode("logs")}
              className={cn(
                "h-7 px-2 text-xs rounded-lg",
                displayMode === "logs"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Table2 className="w-3.5 h-3.5 mr-1" /> Logs
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDisplayMode("cards")}
              className={cn(
                "h-7 px-2 text-xs rounded-lg",
                displayMode === "cards"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Rows3 className="w-3.5 h-3.5 mr-1" /> Cards
            </Button>
          </div>

          <div className="inline-flex items-center rounded-lg border border-studio-border bg-studio-bg/70 p-0.5">
            {(["all", "system", "user"] as const).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="sm"
                onClick={() => setCallerFilter(mode)}
                className={cn(
                  "h-7 px-3 text-xs rounded-lg capitalize",
                  callerFilter === mode
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {mode}
              </Button>
            ))}
          </div>

          <Badge
            variant="secondary"
            className="bg-studio-border/50 text-xs h-5"
          >
            {filteredHistory.length}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-studio-bg border-studio-border"
            />
          </div>

          {onClearHistory !== undefined || connectionId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={showDebugDialog} onOpenChange={setShowDebugDialog}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Query History Debug Logs</DialogTitle>
            <DialogDescription>
              View detailed logs of all query history operations to debug
              connection switching issues
            </DialogDescription>
          </DialogHeader>
          <HistoryDebugViewer />
        </DialogContent>
      </Dialog>

      {displayMode === "logs" ? (
        <div className="flex-1 flex flex-col bg-studio-bg min-h-0 h-full">
          {filteredHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <Clock className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">
                {search ? "No logs match your search" : "No logs yet"}
              </p>
            </div>
          ) : (
            <>
              <div className="w-full bg-transparent overflow-hidden shrink-0 relative">
                <div className="h-0" />
              </div>
              <DataGrid
                results={logGridResults}
                tableStructure={[]}
                customCellRenderer={renderLogCell}
                selectedRows={selectedLogRows}
                setSelectedRows={setSelectedLogRows}
                toggleAllSelection={() => {
                  setSelectedLogRows((prev) =>
                    prev.size === logGridResults.rows.length
                      ? new Set()
                      : new Set(logGridResults.rows.map((_, index) => index)),
                  );
                }}
                toggleRowSelection={(index) => {
                  setSelectedLogRows((prev) => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}
                getRowId={(row) =>
                  row && typeof row === "object" && "__id" in row
                    ? `history:${String(row.__id)}`
                    : null
                }
                pendingChanges={{}}
                setPendingChanges={() => {}}
                editingCell={logEditingCell}
                setEditingCell={setLogEditingCell}
                selectedCell={logSelectedCell}
                setSelectedCell={setLogSelectedCell}
                selectedColumn={logSelectedColumn}
                setSelectedColumn={setLogSelectedColumn}
                hasChanges={() => false}
                getChangedValue={() => null}
                handleUpdateRow={async () => {}}
                handleFKSelection={async () => false}
                handleFKPreview={() => {}}
                loading={false}
                fetchingStructure={false}
                error={null}
                isAddColumnSheetOpen={false}
                setIsAddColumnSheetOpen={() => {}}
                isAddingColumn={false}
                handleAddColumn={async () => {}}
                handleDeleteColumn={async () => {}}
                columnToDelete={null}
                setColumnToDelete={() => {}}
                selectedTable={"query_history"}
                selectedSchema={"studio"}
                sortConfig={logSortConfig}
                setSortConfig={setLogSortConfig}
                pageSize={logPageSize}
                page={logPage}
                totalCount={sortedHistory.length}
                onPageChange={setLogPage}
                onPageSizeChange={setLogPageSize}
                onDuplicateRow={() => {}}
                onCopyRowJSON={(row) =>
                  copyToClipboard(JSON.stringify(row, null, 2))
                }
                onCopyRowCSV={(row) => {
                  const safeRow = row || {};
                  const headers = Object.keys(safeRow)
                    .map((key) => formatDelimitedValue(key, ","))
                    .join(",");
                  const values = Object.values(safeRow)
                    .map((value) => formatDelimitedValue(value, ","))
                    .join(",");
                  copyToClipboard(`${headers}\n${values}`);
                }}
              />
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-4">
            {filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-studio-bg/50 rounded-lg border border-dashed border-studio-border">
                <Clock className="w-12 h-12 mb-4 opacity-10" />
                <p className="text-sm">
                  {search ? "No queries match your search" : "No history yet"}
                </p>
              </div>
            ) : (
              filteredHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "group rounded-lg border border-studio-border bg-studio-bg/30 overflow-hidden transition-all hover:border-studio-border-hover hover:shadow-sm",
                    entry.status === "error" &&
                      "border-red-500/20 bg-red-500/5",
                  )}
                >
                  <div className="px-4 py-3 border-b border-studio-border flex items-center justify-between bg-studio-bg/50">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {entry.status === "success" ? (
                          <div className="w-5 h-5 rounded-lg bg-green-500/10 flex items-center justify-center">
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-lg bg-red-500/10 flex items-center justify-center">
                            <AlertCircle className="w-3 h-3 text-red-500" />
                          </div>
                        )}
                        <span
                          className={cn(
                            "text-xs font-boldtracking-widest",
                            entry.status === "success"
                              ? "text-green-600/70"
                              : "text-red-600/70",
                          )}
                        >
                          {entry.status}
                        </span>
                      </div>

                      <div className="w-[1px] h-3 bg-studio-border" />

                      <span className="text-xs font-medium flex items-center gap-1.5tracking-wider opacity-60">
                        {entry.caller === "user" ? (
                          <>
                            <User className="w-2.5 h-2.5" /> User
                          </>
                        ) : (
                          <>
                            <Cpu className="w-2.5 h-2.5" /> System
                          </>
                        )}
                      </span>

                      <div className="w-[1px] h-3 bg-studio-border" />

                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(entry.executedAt, {
                          addSuffix: true,
                        })}
                      </span>
                      {entry.executedByName || entry.executedBy ? (
                        <>
                          <div className="w-[1px] h-3 bg-studio-border" />
                          <span className="text-xs text-muted-foreground">
                            Ran by {entry.executedByName || entry.executedBy}
                          </span>
                        </>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-4">
                      {entry.rowsCount !== undefined &&
                        entry.status === "success" && (
                          <span className="text-xs font-medium text-muted-foreground bg-studio-border/50 px-2 py-0.5 rounded-lg">
                            {entry.rowsCount}{" "}
                            {entry.rowsCount === 1 ? "row" : "rows"}
                          </span>
                        )}
                      <span className="text-xs font-mono text-muted-foreground">
                        {entry.duration}ms
                      </span>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    <div className="relative group/code">
                      <pre className="text-xs font-mono bg-muted/30 p-4 rounded-lg border border-studio-border/50 overflow-x-auto max-h-64 whitespace-pre-wrap break-all text-foreground/80 leading-relaxed">
                        {entry.query}
                      </pre>
                      <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 bg-studio-bg border border-studio-border shadow-sm gap-2"
                          onClick={() => copyToClipboard(entry.query)}
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy
                        </Button>
                        {onRunQuery ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-8 bg-studio-bg border border-studio-border shadow-sm gap-2"
                            onClick={() => onRunQuery(entry.query)}
                          >
                            <Play className="w-3.5 h-3.5 text-blue-500 fill-blue-500/10" />
                            Run
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {entry.status === "error" && entry.error && (
                      <div className="text-xs text-red-400 font-mono bg-red-500/5 p-3 rounded-lg border border-red-500/10">
                        {entry.error}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
