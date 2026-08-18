"use client";

import {
  AlertCircle,
  Play,
  Square,
  Save,
  Wand2,
  Clock,
  Copy,
  Download,
  ChevronDown,
  Folder as FolderIcon,
  X,
  ArrowRight,
  ArrowLeft,
  History,
  RotateCcw,
  FileCode as FileCodeIcon,
  Brain,
} from "@/lib/icon-theme/lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/studio/data-grid";
import { MonacoSqlInput } from "@/components/studio/monaco-sql-input";
import { SqlQueryInput } from "@/components/studio/sql-query-input";
import {
  SnippetVersion,
  Folder,
  type SqlEditorEngine,
  type SqlEditorSettingsProps,
  type SqlEditorCommonProps,
} from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { format } from "sql-formatter";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatShortcutForPlatform,
  getKeybindingCombo,
} from "@/lib/studio/keybindings";
import type { Keybinding } from "@/lib/studio/keybindings";
import { useSqlAiGeneration } from "@/hooks/use-sql-ai-generation";
import { useSqlAiSettings } from "@/hooks/use-sql-ai-settings";
import { AiModelPicker } from "@/components/studio/ai/ai-model-picker";
import {
  parseThemeJson,
  registerCustomMonacoThemes,
  resolveEditorThemeId,
  getStudioDarkTheme,
  type CustomEditorTheme,
  type MonacoThemeRef,
} from "@/lib/studio/editor-themes";
import { getEditorBadge } from "@/lib/studio/db-labels";
import { getSqlAiPrompt, isSqlAiPrompt } from "@/lib/studio/sql-ai-mode";
import { useAiUser } from "@/hooks/use-ai-user";
import {
  formatDelimitedValue,
  formatSqlLiteral,
} from "@/lib/studio/clipboard-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RequestQueryApprovalDialog } from "@/components/studio/request-query-approval-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { StudioTooltip } from "./studio-tooltip";
import {
  preventTextSelection,
  allowTextSelection,
} from "@/lib/prevent-text-selection";
import type { ExplainResult, PlanNode } from "./database/explain-plan-view";
import { PlanNodeCard, getPlanNode, extractExplainPlan } from "./database/explain-plan-view";

const Editor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false },
);

const DEFAULT_EDITOR_PLACEHOLDER = "Type your query or do / to ask AI";
const AI_EDITOR_PLACEHOLDER =
  "Describe what you want AI to generate or press esc to exit AI mode";

function formatResultsContent(
  formatType: "csv" | "json" | "sql",
  resultRows: any[],
  resultFields: any[],
): { content: string; mimeType?: string; fileExtension?: string } {
  if (formatType === "json") {
    return {
      content: JSON.stringify(resultRows, null, 2),
      mimeType: "application/json",
      fileExtension: ".json",
    };
  }
  if (formatType === "csv") {
    const headers = resultFields
      .map((f: any) => formatDelimitedValue(f.name, ","))
      .join(",");
    const rows = resultRows
      .map((row: any) =>
        resultFields
          .map((f: any) => {
            const val = row[f.name];
            return formatDelimitedValue(val, ",");
          })
          .join(","),
      )
      .join("\n");
    return {
      content: `${headers}\n${rows}`,
      mimeType: "text/csv",
      fileExtension: ".csv",
    };
  }
  if (formatType === "sql") {
    const tableName = "exported_results";
    const content = resultRows
      .map((row: any) => {
        const columns = resultFields.map((f: any) => `"${f.name}"`).join(", ");
        const values = resultFields
          .map((f: any) => formatSqlLiteral(row[f.name]))
          .join(", ");
        return `INSERT INTO ${tableName} (${columns}) VALUES (${values});`;
      })
      .join("\n");
    return { content, fileExtension: ".sql" };
  }
  return { content: "" };
}

interface SqlEditorProps extends SqlEditorSettingsProps, SqlEditorCommonProps {
  connectionId: number;
  connectionString: string;
  editorThemeId?: string;
  customEditorThemes?: CustomEditorTheme[];
  appEditorTheme?: MonacoThemeRef | null;
  layoutVersion?: number;
  keybindings?: Record<string, Keybinding>;
  userId?: string | null;
  /** Hides the results grid so the editor is code-only (used in the bottom
   *  SQL editor panel, where results are not useful). */
  hideResults?: boolean;
  resultTabs?: Array<{
    id: string;
    label: string;
    query: string;
    error: string | null;
    executionTime: number;
  }>;
  activeResultTabId?: string | null;
  onSelectResultTab?: (id: string) => void;
  onCloseResultTab?: (id: string) => void;
  onCloseAllResultTabs?: () => void;
  onCloseOtherResultTabs?: (keepId: string) => void;
  onCloseResultTabsToRight?: (anchorId: string) => void;
  onCloseResultTabsToLeft?: (anchorId: string) => void;
  onOpenUnsavedQuery?: (name: string, query: string) => void;
}

export function SqlEditor({
  connectionId,
  connectionString,
  dbType = "postgres",
  query,
  setQuery,
  error,
  results,
  loading,
  executionTime,
  handleRunQuery,
  handleStopQuery,
  canStopQuery,
  toggleAllSelection,
  selectedRows,
  tableStructure,
  toggleRowSelection,
  setSelectedCell,
  selectedCell,
  snippets,
  folders,
  addSnippet,
  updateSnippet,
  deleteSnippet,
  createSnippetVersion,
  getSnippetVersions,
  restoreSnippetVersion,
  addFolder,
  activeTabId,
  sqlEditorEngine = "monaco",
  editorFontSize = 13,
  editorFontFamily = "",
  editorThemeId = "auto",
  customEditorThemes = [],
  appEditorTheme = null,
  layoutVersion = 0,
  vimMode = false,
  hideResults = false,
  slashAiTrigger = true,
  keybindings = {},
  resultTabsEnabled = false,
  onOpenAiSettings,
  selectedNamespace,
  userId,
  schemaData = {},
  gridProps = {},
  resultTabs = [],
  activeResultTabId = null,
  onSelectResultTab,
  onCloseResultTab,
  onCloseAllResultTabs,
  onCloseOtherResultTabs,
  onCloseResultTabsToRight,
  onCloseResultTabsToLeft,
  onOpenUnsavedQuery,
  sqlFormatTabWidth = 2,
  sqlFormatUseTabs = false,
  sqlFormatKeywordCase = "upper",
  sqlFormatDataTypeCase = "preserve",
  sqlFormatFunctionCase = "preserve",
  sqlFormatIdentifierCase = "preserve",
  sqlFormatLogicalOperatorNewline = "before",
  sqlFormatExpressionWidth = 50,
  sqlFormatLinesBetweenQueries = 2,
  sqlFormatDenseOperators = false,
  sqlFormatNewlineBeforeSemicolon = false,
}: SqlEditorProps) {
  const isMongo = dbType === "mongodb";
  const isRedis = dbType === "redis";

  const normalizedFontSize =
    typeof editorFontSize === "string"
      ? parseInt(editorFontSize, 10) || 13
      : editorFontSize;
  const editorLanguage = isMongo ? "javascript" : isRedis ? "plaintext" : "sql";
  const editorBadge = getEditorBadge(dbType);
  const { theme, resolvedTheme } = useTheme();
  const currentTheme = resolvedTheme || theme;
  const resolvedEditorThemeId = resolveEditorThemeId(
    editorThemeId,
    currentTheme,
    appEditorTheme?.id,
  );
  const aiUser = useAiUser();
  const effectiveUserId = userId ?? aiUser.userId;
  const [aiMode, setAiMode] = useState(false);
  const aiPrompt = query.trim();
  const editorPlaceholder = aiMode
    ? AI_EDITOR_PLACEHOLDER
    : DEFAULT_EDITOR_PLACEHOLDER;
  const aiModeKeybinding = useMemo(
    () => getKeybindingCombo(keybindings, "ACTIVATE_AI_MODE"),
    [keybindings],
  );
  const editorRef = useRef<any>(null);
  const monacoApiRef = useRef<any>(null);
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const runQueryRef = useRef(handleRunQuery);
  const stopQueryRef = useRef(handleStopQuery);
  const canStopQueryRef = useRef(canStopQuery);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.55);
  const isResizingRef = useRef(false);

  // When results first appear (or error), AG Grid may have mounted with 0px height
  // because flex percentage heights aren't always resolved on the first render pass.
  // Dispatching a resize event tells AG Grid to remeasure — the same thing that
  // happens naturally when you switch tabs and come back.
  const hadResultsRef = useRef(false);
  useLayoutEffect(() => {
    const hasContent = !!(error || results);
    if (hasContent && !hadResultsRef.current) {
      hadResultsRef.current = true;
      window.dispatchEvent(new Event("resize"));
    }
    if (!hasContent) {
      hadResultsRef.current = false;
    }
  }, [error, results]);

  const resultRows = React.useMemo(
    () => (Array.isArray(results?.rows) ? results.rows : []),
    [results?.rows],
  );
  const resultFields = React.useMemo(
    () => (Array.isArray(results?.fields) ? results.fields : []),
    [results?.fields],
  );
  const resultRowCount =
    typeof results?.rowCount === "number"
      ? results.rowCount
      : resultRows.length;
  const [localSelectedRows, setLocalSelectedRows] = useState<Set<number>>(
    new Set(),
  );
  const [localSelectedColumn, setLocalSelectedColumn] = useState<string | null>(
    null,
  );
  const [localPendingChanges, setLocalPendingChanges] = useState<
    Record<string, any>
  >({});
  const [localEditingCell, setLocalEditingCell] = useState<any>(null);

  const [newSnippetName, setNewSnippetName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("none");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versionHistoryVersions, setVersionHistoryVersions] = useState<
    SnippetVersion[]
  >([]);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [requestApprovalQuery, setRequestApprovalQuery] = useState<
    string | null
  >(null);

  const isWorkspaceConn = connectionString?.startsWith("workspace:");
  const wsConnectionId = isWorkspaceConn
    ? connectionString.replace("workspace:", "")
    : null;

  useEffect(() => {
    if (
      error &&
      isWorkspaceConn &&
      wsConnectionId &&
      !loading &&
      requestApprovalQuery === null
    ) {
      const lower = error.toLowerCase();
      if (
        lower.includes("read_and_request") ||
        lower.includes("read and request") ||
        lower.includes("write query not allowed") ||
        (lower.includes("read") && lower.includes("request"))
      ) {
        setRequestApprovalQuery(query);
      }
    }
  }, [error, loading]);

  const customMonacoThemes = React.useMemo(() => {
    const parsedThemes = customEditorThemes
      .map((theme) => ({
        id: theme.id,
        parsed: parseThemeJson(theme.themeJson),
      }))
      .filter((theme) => !theme.parsed.error && theme.parsed.theme)
      .map((theme) => ({ id: theme.id, theme: theme.parsed.theme }));
    return appEditorTheme ? [...parsedThemes, appEditorTheme] : parsedThemes;
  }, [customEditorThemes, appEditorTheme]);
  const {
    settings: aiSettings,
    isLoading: isLoadingAiSettings,
    hasAnyModels,
  } = useSqlAiSettings();
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");
  const { generateCommentedSnippet, isGenerating: isGeneratingAiSnippet } =
    useSqlAiGeneration({
      connectionId,
      connectionString,
      dbType,
      provider: aiProvider as any,
      model: aiModel,
      selectedNamespace,
      userId: effectiveUserId,
      schemaData,
    });

  useEffect(() => {
    if (!slashAiTrigger || !isSqlAiPrompt(query)) return;
    setAiMode(true);
    const nextPrompt = getSqlAiPrompt(query);
    if (nextPrompt !== query) {
      setQuery(nextPrompt);
    }
  }, [query, setQuery]);

  const handleEditorChange = useCallback(
    (nextValue: string) => {
      if (slashAiTrigger && isSqlAiPrompt(nextValue)) {
        setAiMode(true);
        setQuery(getSqlAiPrompt(nextValue));
        return;
      }
      if (slashAiTrigger && aiMode && /^\s*\/\s*/.test(nextValue)) {
        setQuery(nextValue.replace(/^\s*\/\s*/, ""));
        return;
      }
      setQuery(nextValue);
    },
    [aiMode, slashAiTrigger, setQuery],
  );

  const handleRequestAiMode = useCallback(() => {
    setAiMode(true);
    if (query) {
      setQuery("");
    }
  }, [query, setQuery]);

  const handleExitAiMode = useCallback(() => {
    setAiMode(false);
    setQuery("");
  }, [setQuery]);

  const handleFormat = () => {
    try {
      if (isMongo) {
        const trimmed = query.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          const parsed = JSON.parse(query);
          setQuery(JSON.stringify(parsed, null, 2));
        }
      } else if (isRedis) {
        setQuery(query);
      } else {
        const dialectMap = {
          postgres: "postgresql",
          mysql: "mysql",
          sqlite: "sqlite",
          clickhouse: "clickhouse",
          mssql: "transactsql",
          trino: "trino",
          duckdb: "postgresql",
          federated: "postgresql",
          spacetimedb: "postgresql",
        } as const;
        const language = dialectMap[dbType] || "postgresql";
        const formatted = format(query, {
          language,
          tabWidth: sqlFormatTabWidth,
          useTabs: sqlFormatUseTabs,
          keywordCase: sqlFormatKeywordCase,
          dataTypeCase: sqlFormatDataTypeCase,
          functionCase: sqlFormatFunctionCase,
          identifierCase: sqlFormatIdentifierCase,
          logicalOperatorNewline: sqlFormatLogicalOperatorNewline,
          expressionWidth: sqlFormatExpressionWidth,
          linesBetweenQueries: sqlFormatLinesBetweenQueries,
          denseOperators: sqlFormatDenseOperators,
          newlineBeforeSemicolon: sqlFormatNewlineBeforeSemicolon,
        });
        setQuery(formatted);
      }
    } catch (e) {
      console.error(
        `Failed to format ${isMongo ? "JSON" : isRedis ? "commands" : "SQL"}:`,
        e,
      );
    }
  };

  const handleSaveSnippet = () => {
    if (!newSnippetName.trim()) return;
    addSnippet(
      newSnippetName,
      query,
      selectedFolderId === "none" ? null : selectedFolderId,
    );
    setIsSaveDialogOpen(false);
    setNewSnippetName("");
    setSelectedFolderId("none");
  };

  const currentSnippetId = activeTabId?.startsWith("sql-")
    ? activeTabId.slice(4)
    : null;
  const existingSnippet = currentSnippetId
    ? snippets.find((s) => s.id === currentSnippetId)
    : null;

  const [latestVersionQuery, setLatestVersionQuery] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!existingSnippet || !getSnippetVersions) {
      setLatestVersionQuery(null);
      return;
    }
    getSnippetVersions(existingSnippet.id).then((result) => {
      if (result.success && result.data && result.data.length > 0) {
        setLatestVersionQuery(result.data[0].query);
      } else {
        setLatestVersionQuery(null);
      }
    });
  }, [existingSnippet, getSnippetVersions]);

  const nothingChanged = query === existingSnippet?.query;
  const versionWouldBeDuplicate =
    !!existingSnippet &&
    latestVersionQuery !== null &&
    existingSnippet.query === latestVersionQuery;
  const isSaveVersionDisabled = nothingChanged || versionWouldBeDuplicate;

  const handleSaveExistingSnippet = useCallback(async () => {
    if (!existingSnippet || !createSnippetVersion) return;
    const oldQuery = existingSnippet.query;
    const oldName = existingSnippet.name;
    const result = await createSnippetVersion(
      existingSnippet.id,
      oldName,
      oldQuery,
    );
    if (!result?.success) {
      toast.error("Failed to save version");
      return;
    }
    updateSnippet(existingSnippet.id, { query });
    toast.success("New version saved");
  }, [existingSnippet, createSnippetVersion, query, updateSnippet]);

  const renderDiff = useCallback(
    (added: number | null, removed: number | null) => {
      if (added === 0 && removed === 0)
        return (
          <span className="text-xs text-muted-foreground/50 shrink-0 font-mono">
            same
          </span>
        );
      return (
        <span className="text-xs shrink-0 font-mono">
          {added! > 0 && <span className="text-emerald-500">+{added}</span>}
          {added! > 0 && removed! > 0 && (
            <span className="text-muted-foreground/40 mx-0.5">/</span>
          )}
          {removed! > 0 && <span className="text-red-500">-{removed}</span>}
        </span>
      );
    },
    [],
  );

  const openVersionHistory = useCallback(async () => {
    if (!existingSnippet || !getSnippetVersions) return;
    setVersionHistoryOpen(true);
    setVersionHistoryLoading(true);
    const result = await getSnippetVersions(existingSnippet.id);
    if (result.success && result.data) {
      setVersionHistoryVersions(result.data);
    }
    setVersionHistoryLoading(false);
  }, [existingSnippet, getSnippetVersions]);

  const formatVersionDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return (
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    );
  };

  const computeVersionDiff = useCallback(
    (versionQuery: string, compareQuery: string) => {
      const curLines = versionQuery.split("\n");
      const cmpLines = compareQuery.split("\n");
      const added = Math.max(0, cmpLines.length - curLines.length);
      const removed = Math.max(0, curLines.length - cmpLines.length);
      if (added === 0 && removed === 0) return null;
      return { added, removed };
    },
    [],
  );

  const handleRestoreVersion = useCallback(
    async (version: SnippetVersion) => {
      if (!existingSnippet || !restoreSnippetVersion || !createSnippetVersion)
        return;
      const result = await createSnippetVersion(
        existingSnippet.id,
        existingSnippet.name,
        existingSnippet.query,
      );
      if (!result?.success) {
        toast.error("Failed to backup current state");
        return;
      }
      await restoreSnippetVersion(existingSnippet.id, version.id);
      toast.success(`Restored v${version.versionNumber}`);
      const reFetch = await getSnippetVersions!(existingSnippet.id);
      if (reFetch.success && reFetch.data) {
        setVersionHistoryVersions(reFetch.data);
      }
    },
    [
      existingSnippet,
      restoreSnippetVersion,
      createSnippetVersion,
      getSnippetVersions,
    ],
  );

  const handleOpenVersionInTab = useCallback(
    (version: SnippetVersion) => {
      if (!onOpenUnsavedQuery) return;
      onOpenUnsavedQuery(
        `${existingSnippet?.name} v${version.versionNumber}`,
        version.query,
      );
    },
    [existingSnippet, onOpenUnsavedQuery],
  );

  const handleExport = (formatType: "csv" | "json" | "sql") => {
    if (!results) return;

    const { content, mimeType, fileExtension } = formatResultsContent(
      formatType,
      resultRows,
      resultFields,
    );
    const fileName = `export-${Date.now()}${fileExtension ?? ""}`;

    const blob = new Blob([content], { type: mimeType ?? "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (formatType: "csv" | "json" | "sql") => {
    if (!results) return;

    const { content } = formatResultsContent(
      formatType,
      resultRows,
      resultFields,
    );

    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Failed to copy results:", err);
    }
  };

  const handleCopyQuery = async () => {
    try {
      await navigator.clipboard.writeText(query);
      toast.success("Query copied to clipboard");
    } catch {
      toast.error("Failed to copy query");
    }
  };

  useEffect(() => {
    runQueryRef.current = handleRunQuery;
  }, [handleRunQuery]);

  useEffect(() => {
    stopQueryRef.current = handleStopQuery;
  }, [handleStopQuery]);

  useEffect(() => {
    canStopQueryRef.current = canStopQuery;
  }, [canStopQuery]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const ratio = y / rect.height;
      const clamped = Math.min(0.8, Math.max(0.2, ratio));
      setSplitRatio(clamped);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        allowTextSelection();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const registerSqlCompletionProvider = useCallback(() => {
    if (isMongo || isRedis || !monacoApiRef.current) return;

    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
      completionProviderRef.current = null;
    }

    const monaco = monacoApiRef.current;
    completionProviderRef.current =
      monaco.languages.registerCompletionItemProvider("sql", {
        triggerCharacters: [".", " "],
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions = [];
          const schemaEntries = Object.entries(schemaData || {}) as Array<
            [string, any]
          >;

          for (const [tableKey, tableData] of schemaEntries) {
            const tableName = String(tableData?.name || tableKey);
            const schemaName = String(tableData?.schema || "");
            suggestions.push({
              label: tableName,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: tableName,
              detail: schemaName ? `Table (${schemaName})` : "Table",
              range,
            });
          }

          const lineContent = model.getLineContent(position.lineNumber);
          const lineUntilPosition = lineContent.substring(
            0,
            position.column - 1,
          );
          const match = lineUntilPosition.match(/([a-zA-Z0-9_"]+)\.$/);

          if (match) {
            const tableToken = match[1].replace(/"/g, "");
            const matchingEntry = schemaEntries.find(
              ([tableKey, tableData]) => {
                const candidateName = String(tableData?.name || tableKey);
                const candidateSchema = String(tableData?.schema || "");
                const schemaQualified = candidateSchema
                  ? `${candidateSchema}.${candidateName}`
                  : candidateName;
                return (
                  tableToken === candidateName ||
                  tableToken === schemaQualified ||
                  tableToken === tableKey
                );
              },
            );
            const tableData = matchingEntry?.[1];
            if (tableData && Array.isArray(tableData.columns)) {
              tableData.columns.forEach((col: any) => {
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  detail: `${col.type}${col.isPrimary ? " (PK)" : ""}`,
                  range,
                });
              });
            }
          }

          const keywords = [
            "SELECT",
            "FROM",
            "WHERE",
            "INSERT",
            "UPDATE",
            "DELETE",
            "CREATE",
            "DROP",
            "ALTER",
            "TABLE",
            "INTO",
            "VALUES",
            "SET",
            "AND",
            "OR",
            "NOT",
            "NULL",
            "JOIN",
            "LEFT",
            "RIGHT",
            "INNER",
            "OUTER",
            "ON",
            "GROUP",
            "BY",
            "ORDER",
            "LIMIT",
            "OFFSET",
            "HAVING",
            "AS",
            "DISTINCT",
            "COUNT",
            "SUM",
            "AVG",
            "MIN",
            "MAX",
            "CAST",
            "COALESCE",
            "CASE",
            "WHEN",
            "THEN",
            "ELSE",
            "END",
            "UNION",
            "ALL",
            "EXISTS",
            "IN",
            "LIKE",
            "BETWEEN",
            "IS",
          ];

          keywords.forEach((keyword) => {
            suggestions.push({
              label: keyword,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: keyword,
              range,
            });
          });

          return { suggestions };
        },
      });
  }, [isMongo, isRedis, schemaData]);

  useEffect(() => {
    registerSqlCompletionProvider();
  }, [registerSqlCompletionProvider]);

  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
    };
  }, []);

  const handleEditorWillMount = (monaco: any) => {
    monacoApiRef.current = monaco;

    monaco.editor.defineTheme("studio-dark", getStudioDarkTheme());

    registerCustomMonacoThemes(monaco, customMonacoThemes);

    registerSqlCompletionProvider();
  };

  const handleRun = () => {
    setExplainPlanResult(null);
    handleRunQuery();
  };

  const handleRunSelected = () => {
    if (!selectedQuery.trim()) return;
    setExplainPlanResult(null);
    handleRunQuery(selectedQuery);
  };

  const [explainPlanResult, setExplainPlanResult] =
    useState<ExplainResult | null>(null);
  const [showPlanView, setShowPlanView] = useState(false);

  const handleExplain = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      toast.error("Enter a query first");
      return;
    }
    const startsWithExplain = /^\s*EXPLAIN\b/i.test(trimmed);
    const explainQuery = startsWithExplain
      ? trimmed
      : `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON)\n${trimmed}`;
    handleRunQuery(explainQuery);
  }, [query, handleRunQuery]);

  useEffect(() => {
    if (!results?.rows?.length) {
      setExplainPlanResult(null);
      setShowPlanView(false);
      return;
    }
    try {
      const plan = extractExplainPlan(results.rows[0]);
      if (plan) {
        setExplainPlanResult(plan);
        setShowPlanView(true);
        return;
      }
    } catch {}
    setExplainPlanResult(null);
    setShowPlanView(false);
  }, [results]);

  const handleGenerateAiSnippet = useCallback(async () => {
    if (!aiMode) return;
    if (!connectionString.trim()) {
      toast.error("No active connection is available for AI generation.");
      return;
    }
    if (!hasAnyModels) {
      toast.error("Configure an AI provider with an API key and model first.");
      onOpenAiSettings?.();
      return;
    }

    try {
      const nextQuery = await generateCommentedSnippet(aiPrompt);
      setAiMode(false);
      setQuery(nextQuery);
      setHasSelection(false);
      setSelectedQuery("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate AI snippet.";
      toast.error(message);
    }
  }, [
    aiMode,
    aiPrompt,
    connectionString,
    generateCommentedSnippet,
    hasAnyModels,
    onOpenAiSettings,
    setQuery,
  ]);

  const syncSelectionState = useCallback((editor: any) => {
    const model = editor?.getModel?.();
    const selection = editor?.getSelection?.();
    if (!model || !selection || selection.isEmpty()) {
      setHasSelection(false);
      setSelectedQuery("");
      return;
    }
    const text = model.getValueInRange(selection);
    if (!text || !text.trim()) {
      setHasSelection(false);
      setSelectedQuery("");
      return;
    }
    setHasSelection(true);
    setSelectedQuery(text);
  }, []);

  useEffect(() => {
    if (editorRef.current?.isDisposed?.()) return;
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== query) {
        editorRef.current.setValue(query);
      }
    }
  }, [query]);

  useEffect(() => {
    if (!monacoApiRef.current) return;
    if (editorRef.current?.isDisposed?.()) return;
    registerCustomMonacoThemes(monacoApiRef.current, customMonacoThemes);
    monacoApiRef.current.editor.setTheme(resolvedEditorThemeId);
  }, [customMonacoThemes, resolvedEditorThemeId]);

// fallow-ignore-next-line code-duplication
  useEffect(() => {
    if (!editorRef.current || editorRef.current.isDisposed?.()) return;
    const handle = window.requestAnimationFrame(() => {
      editorRef.current?.layout?.();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [layoutVersion]);

  const effectiveSelectedRows = gridProps.setSelectedRows
    ? selectedRows
    : localSelectedRows;
  const setEffectiveSelectedRows =
    gridProps.setSelectedRows ?? setLocalSelectedRows;
  const effectiveToggleAllSelection =
    gridProps.toggleAllSelection ?? toggleAllSelection ?? (() => {});
  const effectiveToggleRowSelection =
    gridProps.toggleRowSelection ?? toggleRowSelection ?? (() => {});

  const dataGridElement = (
    <DataGrid
      results={results}
      tableStructure={tableStructure}
      pendingActions={gridProps.pendingActions ?? []}
      selectedRows={effectiveSelectedRows}
      setSelectedRows={setEffectiveSelectedRows}
      toggleAllSelection={effectiveToggleAllSelection}
      toggleRowSelection={effectiveToggleRowSelection}
      getRowId={
        gridProps.getRowId ??
        ((_row: any, _index: number) => null)
      }
      pendingChanges={
        gridProps.pendingChanges ?? localPendingChanges
      }
      setPendingChanges={
        gridProps.setPendingChanges ?? setLocalPendingChanges
      }
      editingCell={gridProps.editingCell ?? localEditingCell}
      setEditingCell={
        gridProps.setEditingCell ?? setLocalEditingCell
      }
      selectedCell={selectedCell}
      setSelectedCell={setSelectedCell}
      selectedColumn={
        gridProps.selectedColumn ?? localSelectedColumn
      }
      setSelectedColumn={
        gridProps.setSelectedColumn ?? localSelectedColumn
      }
      hasChanges={gridProps.hasChanges ?? (() => false)}
      getChangedValue={
        gridProps.getChangedValue ?? (() => undefined)
      }
      handleUpdateRow={
        gridProps.handleUpdateRow ?? (async () => {})
      }
      handleFKSelection={
        gridProps.handleFKSelection ?? (async () => false)
      }
      handleFKPreview={gridProps.handleFKPreview ?? (() => {})}
      loading={loading}
      fetchingStructure={Boolean(gridProps.fetchingStructure)}
      error={error}
      isAddColumnSheetOpen={Boolean(
        gridProps.isAddColumnSheetOpen,
      )}
      setIsAddColumnSheetOpen={
        gridProps.setIsAddColumnSheetOpen ?? (() => {})
      }
      isAddingColumn={Boolean(gridProps.isAddingColumn)}
      handleAddColumn={
        gridProps.handleAddColumn ?? (async () => {})
      }
      handleDeleteColumn={
        gridProps.handleDeleteColumn ?? (async () => {})
      }
      columnToDelete={gridProps.columnToDelete ?? null}
      setColumnToDelete={
        gridProps.setColumnToDelete ?? (() => {})
      }
      selectedTable={gridProps.selectedTable ?? null}
      selectedSchema={gridProps.selectedSchema ?? null}
      sortConfig={gridProps.sortConfig ?? null}
      setSortConfig={gridProps.setSortConfig ?? (() => {})}
      pageSize={
        gridProps.pageSize ?? Math.max(resultRows.length, 1)
      }
      page={gridProps.page ?? 0}
      totalCount={gridProps.totalCount ?? resultRowCount}
      onPageChange={gridProps.onPageChange ?? (() => {})}
      onPageSizeChange={
        gridProps.onPageSizeChange ?? (() => {})
      }
      onDuplicateRow={gridProps.onDuplicateRow ?? (() => {})}
      onCopyRowJSON={gridProps.onCopyRowJSON ?? (() => {})}
      onCopyRowCSV={gridProps.onCopyRowCSV ?? (() => {})}
      onFilterByCell={gridProps.onFilterByCell}
      onNavigateToTable={gridProps.onNavigateToTable}
      onOpenInsertSheet={gridProps.onOpenInsertSheet}
      rowSpacing={gridProps.rowSpacing ?? "relaxed"}
      alternatingRowColors={Boolean(
        gridProps.alternatingRowColors,
      )}
      connectionString={gridProps.connectionString ?? ""}
      foreignKeys={gridProps.foreignKeys ?? []}
      enums={gridProps.enums ?? []}
      globalSearchQuery={gridProps.globalSearchQuery ?? ""}
      showPaginationFooter={Boolean(
        gridProps.showPaginationFooter,
      )}
      isKeyboardInputSuspended={Boolean(
        gridProps.isKeyboardInputSuspended,
      )}
    />
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-studio-bg relative">
      {/* Editor Toolbar */}
      <div className="h-12 border-b border-studio-border bg-studio-header-bg flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          {aiMode ? (
            <Button
              onClick={handleGenerateAiSnippet}
              size="sm"
              disabled={isGeneratingAiSnippet}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs px-3 font-semibold flex items-center gap-2"
            >
              <Wand2 className="w-3.5 h-3.5" />
              {isGeneratingAiSnippet ? "Generating..." : "Generate Snippet"}
              <span className="text-xs opacity-60 ml-1">
                {formatShortcutForPlatform("Cmd+Enter")}
              </span>
            </Button>
          ) : hasSelection ? (
            <Button
              onClick={handleRunSelected}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs px-3 font-semibold flex items-center gap-2"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Run Selected
              <span className="text-xs opacity-60 ml-1">
                {formatShortcutForPlatform("Cmd+Shift+Enter")}
              </span>
            </Button>
          ) : (
            <Button
              onClick={handleRun}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs px-3 font-semibold flex items-center gap-2"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {isMongo ? "Run Shell" : isRedis ? "Run Command" : "Run Query"}
              <span className="text-xs opacity-60 ml-1">
                {formatShortcutForPlatform("Cmd+Enter")}
              </span>
            </Button>
          )}
          {loading && (
            <Button
              onClick={handleStopQuery}
              disabled={!canStopQuery}
              size="sm"
              variant="outline"
              className="h-8 text-xs px-3 font-semibold flex items-center gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Square className="w-3 h-3 fill-current" />
              Stop
              <span className="text-xs opacity-60 ml-1">
                {formatShortcutForPlatform("Cmd+.")}
              </span>
            </Button>
          )}
          <div className="w-[1px] h-4 bg-studio-border mx-1" />
          {!isRedis && !isMongo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={handleExplain}
              title="Explain Plan (Ctrl+E)"
              disabled={loading || !query.trim()}
            >
              <Brain className="w-4 h-4" />
            </Button>
          )}
          <div className="w-[1px] h-4 bg-studio-border mx-1" />
          {!isRedis && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={handleFormat}
              title={`Format ${editorBadge}`}
            >
              <Wand2 className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleCopyQuery}
            title="Copy Query"
          >
            <Copy className="w-4 h-4" />
          </Button>
          {existingSnippet ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={handleSaveExistingSnippet}
              disabled={isSaveVersionDisabled}
              title={nothingChanged ? "No changes to save" : "Save Snippet"}
            >
              <Save className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setIsSaveDialogOpen(true)}
              title="Save Snippet"
            >
              <Save className="w-4 h-4" />
            </Button>
          )}
          {existingSnippet && createSnippetVersion && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={openVersionHistory}
              title="Version History"
            >
              <History className="w-4 h-4" />
            </Button>
          )}
          {aiMode && (
            <>
              <div className="w-[1px] h-4 bg-studio-border mx-1" />
              {aiSettings && hasAnyModels ? (
                <AiModelPicker
                  currentProvider={aiProvider}
                  currentModel={aiModel}
                  onAddModels={() => onOpenAiSettings?.()}
                  onSelectProvider={(provider, model) => {
                    setAiProvider(provider);
                    setAiModel(model);
                  }}
                  settings={aiSettings}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLoadingAiSettings}
                  className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenAiSettings?.()}
                >
                  {isLoadingAiSettings ? "Loading AI..." : "Add Models"}
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAiMode(!aiMode)}
            className={`h-7 text-xs font-boldpx-2 ${
              aiMode
                ? "bg-chart-2/10 border border-chart-2/20 text-chart-2 hover:bg-chart-2/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {aiMode ? "AI Mode" : "SQL Mode"}
          </Button>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-secondary/30 border border-studio-border">
            <span className="text-xs font-bold text-muted-foreground uppercase">
              {editorBadge}
            </span>
          </div>
          {(loading || results) && (
            <div className="flex items-center gap-1.5 text-muted-foreground min-w-[80px] justify-end">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-xs font-mono">
                {(executionTime || 0).toFixed(0)}ms
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Editor Content */}
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0 relative">
        <div className="absolute inset-0 flex flex-col">
          {/* Editor Area - Absolute Positioning to force stability */}
          <div
            className={`flex flex-col relative overflow-hidden bg-studio-bg shrink-0 ${hideResults ? "" : "border-b border-studio-border"}`}
            style={{ height: hideResults ? "100%" : `${splitRatio * 100}%` }}
          >
            <div className="flex-1 flex overflow-hidden relative">
              <div className="flex-1 relative">
                {(() => {
                  const sharedEditorProps = {
                    dbType,
                    fontSize: normalizedFontSize,
                    fontFamily: editorFontFamily,
                    aiMode,
                    onChange: handleEditorChange,
                    onRequestAiMode: handleRequestAiMode,
                    onExitAiMode: handleExitAiMode,
                    placeholder: editorPlaceholder,
                    onRun: aiMode ? handleGenerateAiSnippet : handleRun,
                    onRunSelected: aiMode ? handleGenerateAiSnippet : handleRunSelected,
                    onSaveSnippet: () => setIsSaveDialogOpen(true),
                    onCopyQuery: handleCopyQuery,
                    onFormat: handleFormat,
                    onSelectionChange: (selectedText: string) => {
                      const next = selectedText.trim();
                      setHasSelection(Boolean(next));
                      setSelectedQuery(next);
                    },
                    query,
                    schemaData,
                    slashAiTrigger,
                    aiModeKeybinding,
                  };
                  return sqlEditorEngine === "monaco" ? (
                    <MonacoSqlInput
                      {...sharedEditorProps}
                      appEditorTheme={appEditorTheme}
                      customEditorThemes={customEditorThemes}
                      layoutVersion={layoutVersion}
                      themeId={resolvedEditorThemeId}
                      vimMode={vimMode}
                    />
                  ) : (
                    <SqlQueryInput
                      {...sharedEditorProps}
                    />
                  );
                })()}
              </div>
            </div>
          </div>

          {!hideResults && (
          <div
            className="h-[2px] bg-studio-border cursor-row-resize shrink-0 hover:bg-blue-500/40 transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              isResizingRef.current = true;
              document.body.style.cursor = "row-resize";
              preventTextSelection();
            }}
          />
          )}

          {!hideResults && (
          <div
            className="flex flex-col bg-studio-bg overflow-hidden relative"
            style={{
              height: `${(1 - splitRatio) * 100}%`,
              flexShrink: 0,
              minHeight: 0,
              willChange: "transform",
            }}
          >
            {/* Loading Beam for Query Results */}
            <div className="h-[1px] w-full bg-transparent overflow-hidden shrink-0 relative z-30">
              {loading && (
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    className="h-full w-full bg-gradient-to-r from-transparent via-blue-500/40 via-blue-400 via-blue-500/40 to-transparent animate-progress-beam"
                    style={{ width: "100%" }}
                  />
                </div>
              )}
            </div>

            {error || results || resultTabs.length > 0 ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Result Tabs Bar */}
                {resultTabs.length > 0 && (
                  <div className="h-10 border-b border-studio-border bg-studio-bg relative shrink-0">
                    <div className="absolute inset-0 flex items-center overflow-x-auto tabs-scrollbar z-10">
                      <div className="flex items-center h-10">
                        {resultTabs.map((tab, _idx) => {
                          const isActive = tab.id === activeResultTabId;
                          return (
                            <ContextMenu key={tab.id}>
                              <ContextMenuTrigger>
                                <div
                                  onClick={() => onSelectResultTab?.(tab.id)}
                                  className={`h-10 flex items-center gap-2 px-3 text-xs group relative select-none cursor-pointer ${
                                    isActive
                                      ? "bg-studio-tab-active text-foreground"
                                      : "bg-studio-tab-inactive text-muted-foreground/40 hover:bg-studio-row-hover hover:text-muted-foreground/60"
                                  }`}
                                >
                                  <span
                                    className={`truncate flex-1 text-left`}
                                  >
                                    {tab.label}
                                  </span>
                                  <StudioTooltip label="Close Tab">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onCloseResultTab?.(tab.id);
                                      }}
                                      className={`p-0.5 rounded-lg hover:bg-muted/40 opacity-0 group-hover:opacity-100 ${isActive ? "opacity-100" : ""}`}
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </StudioTooltip>
                                  {isActive && (
                                    <div className="absolute top-0 left-0 right-0 h-[1px] bg-primary shadow-[0_0_8px_var(--ring)]" />
                                  )}
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-44">
                                <ContextMenuItem
                                  className="text-xs"
                                  onClick={() => onCloseResultTab?.(tab.id)}
                                >
                                  <X className="mr-2 h-3.5 w-3.5" />
                                  Close
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  className="text-xs"
                                  disabled={resultTabs.length <= 1}
                                  onClick={() =>
                                    onCloseOtherResultTabs?.(tab.id)
                                  }
                                >
                                  Close Others
                                </ContextMenuItem>
                                <ContextMenuItem
                                  className="text-xs"
                                  onClick={() => onCloseAllResultTabs?.()}
                                >
                                  Close All
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  className="text-xs"
                                  disabled={_idx === resultTabs.length - 1}
                                  onClick={() =>
                                    onCloseResultTabsToRight?.(tab.id)
                                  }
                                >
                                  <ArrowRight className="mr-2 h-3.5 w-3.5" />
                                  Close Tabs To Right
                                </ContextMenuItem>
                                <ContextMenuItem
                                  className="text-xs"
                                  disabled={_idx === 0}
                                  onClick={() =>
                                    onCloseResultTabsToLeft?.(tab.id)
                                  }
                                >
                                  <ArrowLeft className="mr-2 h-3.5 w-3.5" />
                                  Close Tabs To Left
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Results Header */}
                {(error || results) && (
                  <div className="h-10 border-b border-studio-border flex items-center justify-between px-4 shrink-0 bg-studio-header-bg">
                    <div className="flex items-center gap-4">
                      {error ? (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(error);
                            toast.success("Error copied to clipboard");
                          }}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <div className="flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer transition-colors group">
                                <Copy className="w-3.5 h-3.5" />
                                <ChevronDown className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                              </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="start"
                              className="w-40 bg-popover border-studio-border z-[80]"
                            >
                              <DropdownMenuItem
                                onClick={() => handleCopy("csv")}
                                className="text-xs"
                              >
                                Copy as CSV
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleCopy("json")}
                                className="text-xs"
                              >
                                Copy as JSON
                              </DropdownMenuItem>
                              {!isMongo && !isRedis && (
                                <DropdownMenuItem
                                  onClick={() => handleCopy("sql")}
                                  className="text-xs"
                                >
                                  Copy as SQL Inserts
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <div className="flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer transition-colors group">
                                <Download className="w-3.5 h-3.5" />
                                <ChevronDown className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                              </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="start"
                              className="w-40 bg-popover border-studio-border z-[80]"
                            >
                              <DropdownMenuItem
                                onClick={() => handleExport("csv")}
                                className="text-xs"
                              >
                                Export as CSV
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleExport("json")}
                                className="text-xs"
                              >
                                Export as JSON
                              </DropdownMenuItem>
                              {!isMongo && !isRedis && (
                                <DropdownMenuItem
                                  onClick={() => handleExport("sql")}
                                  className="text-xs"
                                >
                                  Export as SQL Inserts
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {error ? (
                        <span className="text-destructive">Query Error</span>
                      ) : (
                        <>
                          {resultRowCount}{" "}
                          {resultRowCount === 1 ? "row" : "rows"}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {error ? (
                  <div className="flex-1 p-4 text-destructive bg-destructive/5 flex items-start gap-3 overflow-auto">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Query Error</p>
                      <pre className="text-xs whitespace-pre-wrap font-mono opacity-80">
                        {error}
                      </pre>
                    </div>
                  </div>
                ) : results && resultRowCount === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-sm text-foreground/80 bg-studio-bg">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground/60">
                        Success. No rows returned
                      </p>
                    </div>
                  </div>
                ) : results && explainPlanResult && showPlanView ? (
                  <div className="flex-1 overflow-y-auto p-4 bg-studio-bg">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-foreground">
                        Query Plan
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPlanView(false)}
                      >
                        Show Table
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {explainPlanResult["Planning Time"] !== undefined && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>
                            Planning: {explainPlanResult["Planning Time"]}ms
                          </span>
                          {explainPlanResult["Execution Time"] !==
                            undefined && (
                            <span>
                              Execution: {explainPlanResult["Execution Time"]}ms
                            </span>
                          )}
                        </div>
                      )}
                      <div className="bg-background/20 border border-studio-border rounded-lg">
                        <PlanNodeCard
                          node={getPlanNode(explainPlanResult)!}
                          depth={0}
                        />
                      </div>
                    </div>
                  </div>
                ) : results ? (
                  explainPlanResult ? (
                    <div className="flex-1 flex flex-col">
                      <div className="flex items-center justify-end px-4 py-1 border-b border-studio-border">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPlanView(true)}
                        >
                          Show Plan
                        </Button>
                      </div>
                      {dataGridElement}
                    </div>
                  ) : (
                    <>{dataGridElement}</>
                  )
                ) : loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-lg border-2 border-blue-500 border-t-transparent animate-spin" />
                    <span className="text-xs font-medium">
                      Running query...
                    </span>
                  </div>
                ) : !loading ? (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground/20 bg-studio-bg">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground/40">
                        No results to display
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              !loading && (
                <div className="flex-1 flex items-center justify-center text-muted-foreground/20 bg-studio-bg">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground/40">
                      No results to display
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        )}
        </div>
      </div>

      {/* Save Snippet Dialog */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-studio-bg border-studio-border p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-sm font-bold flex items-center gap-2">
              <Save className="w-5 h-5 text-blue-500" />
              Save Query Snippet
            </DialogTitle>
            <DialogDescription className="sr-only">
              Give your query snippet a name and optional folder to save it for
              later use.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 p-6">
            <div className="grid gap-2">
              <Label htmlFor="name" className="text-xs text-muted-foreground">
                Snippet Name
              </Label>
              <Input
                id="name"
                value={newSnippetName}
                onChange={(e) => setNewSnippetName(e.target.value)}
                placeholder="e.g. Fetch all users"
                className="h-8 bg-studio-bg border-studio-border text-sm"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="folder" className="text-xs text-muted-foreground">
                Folder (Optional)
              </Label>
              <Select
                value={selectedFolderId}
                onValueChange={setSelectedFolderId}
              >
                <SelectTrigger className="h-8 bg-studio-bg border-studio-border text-sm">
                  <SelectValue placeholder="Select a folder" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-studio-border">
                  <SelectItem value="none" className="text-sm">
                    No Folder
                  </SelectItem>
                  {folders.map((folder) => (
                    <SelectItem
                      key={folder.id}
                      value={folder.id}
                      className="text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <FolderIcon className="w-3.5 h-3.5" />
                        {folder.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="bg-studio-header-bg p-4 border-t border-studio-border">
            <Button
              variant="ghost"
              onClick={() => setIsSaveDialogOpen(false)}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSnippet}
              disabled={!newSnippetName.trim()}
              className="h-8 text-xs bg-blue-600 hover:bg-blue-700"
            >
              Save Snippet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Dialog */}
      <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
        <DialogContent
          className={cn(
            "max-h-[80vh] flex flex-col",
            versionHistoryVersions.length <= 3
              ? "sm:max-w-[380px]"
              : "sm:max-w-[420px]",
          )}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <History className="w-4 h-4" />
              Version History: {existingSnippet?.name}
            </DialogTitle>
            <DialogDescription>
              Previous versions of this snippet. Restoring creates a backup
              first.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {versionHistoryLoading ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                Loading versions...
              </div>
            ) : versionHistoryVersions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Clock className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  No version history yet.
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Versions are created when you save changes to an existing
                  snippet.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[360px] pr-3">
                <div className="space-y-1">
                  {versionHistoryVersions.map((version, idx) => {
                    const nextVersion = versionHistoryVersions[idx + 1];
                    const diff = nextVersion
                      ? computeVersionDiff(nextVersion.query, version.query)
                      : null;
                    return (
                      <div
                        key={version.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors group"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-xs font-semibold text-foreground shrink-0 w-7">
                            v{version.versionNumber}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">
                            {formatVersionDate(version.createdAt)}
                          </span>
                          {diff ? renderDiff(diff.added, diff.removed) : null}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => handleOpenVersionInTab(version)}
                            title="Open in new tab"
                          >
                            <FileCodeIcon className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => handleRestoreVersion(version)}
                            title="Restore this version"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {requestApprovalQuery && wsConnectionId && (
        <RequestQueryApprovalDialog
          isOpen={true}
          onClose={() => setRequestApprovalQuery(null)}
          connectionId={wsConnectionId}
          connectionName={connectionString}
          sql={requestApprovalQuery}
        />
      )}
    </div>
  );
}
