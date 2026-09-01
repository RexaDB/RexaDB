"use client";

import React from "react";
import dynamic from "next/dynamic";
import {
  Database,
  AlertCircle,
  CheckSquare,
  Loader2,
  FileCode2,
  Rows3,
  Clock4,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTheme } from "next-themes";
import { resolveEditorThemeId, getStudioDarkTheme } from "@/lib/studio/editor-themes";
import { registerCustomMonacoThemes } from "@/lib/studio/editor-themes";
import type { CustomEditorTheme } from "@/lib/studio/editor-themes";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full min-h-[200px] text-xs text-muted-foreground">
      Loading editor...
    </div>
  ),
});

interface PendingChangesSheetProps {
  selectedSchema: string;
  selectedTable: string | null;
  pendingChanges: Record<string, Record<string, { old: any; new: any }>>;
  setPendingChanges: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, { old: any; new: any }>>>
  >;
  pendingActions: Array<{
    id: string;
    type:
      | "add_column"
      | "delete_column"
      | "rename_column"
      | "edit_column"
      | "create_table"
      | "delete_table"
      | "create_enum"
      | "delete_enum"
      | "create_index"
      | "delete_index"
      | "create_trigger"
      | "delete_trigger"
      | "create_schema"
      | "delete_schema"
      | "create_database"
      | "delete_database"
      | "delete_row"
      | "insert_row"
      | "duplicate_row"
      | "duplicate_table"
      | "empty_table"
      | "delete_function"
      | "update_function"
      | "redis_command"
      | "create_rls_policy"
      | "update_rls_policy"
      | "delete_rls_policy"
      | "add_fk";
    description: string;
    sql: string;
    metadata: any;
  }>;
  setPendingActions: React.Dispatch<
    React.SetStateAction<
      Array<{
        id: string;
        type:
          | "add_column"
          | "delete_column"
          | "rename_column"
          | "edit_column"
          | "create_table"
          | "delete_table"
          | "create_enum"
          | "delete_enum"
          | "create_index"
          | "delete_index"
          | "create_trigger"
          | "delete_trigger"
          | "create_schema"
          | "delete_schema"
          | "create_database"
          | "delete_database"
          | "delete_row"
          | "insert_row"
          | "duplicate_row"
          | "duplicate_table"
          | "empty_table"
          | "delete_function"
          | "update_function"
          | "redis_command"
          | "create_rls_policy"
          | "update_rls_policy"
          | "delete_rls_policy"
          | "add_fk";
        description: string;
        sql: string;
        metadata: any;
      }>
    >
  >;
  isReviewSheetOpen: boolean;
  setIsReviewSheetOpen: (open: boolean) => void;
  handleCommitChanges: () => void;
  loading: boolean;
  editorFontSize?: string;
  editorFontFamily?: string;
  editorThemeId?: string;
  customEditorThemes?: CustomEditorTheme[];
  appEditorTheme?: { id: string } | null;
}

export function PendingChangesSheet({
  selectedSchema,
  selectedTable,
  pendingChanges,
  setPendingChanges,
  pendingActions,
  setPendingActions,
  isReviewSheetOpen,
  setIsReviewSheetOpen,
  handleCommitChanges,
  loading,
  editorFontSize: editorFontSizeProp,
  editorFontFamily,
  editorThemeId: editorThemeIdProp,
  customEditorThemes,
  appEditorTheme,
}: PendingChangesSheetProps) {
  const [viewMode, setViewMode] = React.useState<"visual" | "sql">("visual");
  const pendingCount =
    Object.keys(pendingChanges).length + pendingActions.length;
  const { theme, resolvedTheme } = useTheme();
  const currentTheme = resolvedTheme || theme;
  const effectiveEditorThemeId =
    editorThemeIdProp === "auto" && appEditorTheme
      ? appEditorTheme.id
      : editorThemeIdProp;

  const fontSize =
    typeof editorFontSizeProp === "string"
      ? parseInt(editorFontSizeProp, 10) || 13
      : editorFontSizeProp || 13;

  const resolvedThemeId = resolveEditorThemeId(
    effectiveEditorThemeId || "auto",
    currentTheme,
    appEditorTheme?.id,
  );

  const toSqlIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const toSqlLiteral = (value: unknown) => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number")
      return Number.isFinite(value) ? String(value) : "NULL";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "object") {
      try {
        const json = JSON.stringify(value).replace(/'/g, "''");
        return `'${json}'::jsonb`;
      } catch {
        return `'${String(value).replace(/'/g, "''")}'`;
      }
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  };
  const parseRowIdConditions = (rowId: string) => {
    if (rowId.startsWith("idx:")) return null;
    const parts = rowId.split("|");
    const clauses: string[] = [];
    for (const part of parts) {
      const firstColonIndex = part.indexOf(":");
      if (firstColonIndex <= 0) continue;
      const column = part.substring(0, firstColonIndex);
      const rawValue = part.substring(firstColonIndex + 1);
      clauses.push(`${toSqlIdentifier(column)} = ${toSqlLiteral(rawValue)}`);
    }
    return clauses.length ? clauses : null;
  };
  const buildUpdateSql = (
    rowId: string,
    changes: Record<string, { old: unknown; new: unknown }>,
  ) => {
    if (!selectedSchema || !selectedTable) {
      return `-- Unable to generate SQL preview for row ${rowId}: no schema/table selected`;
    }
    const setClauses = Object.entries(changes).map(
      ([column, value]) =>
        `${toSqlIdentifier(column)} = ${toSqlLiteral(value.new)}`,
    );
    const whereClauses = parseRowIdConditions(rowId);
    if (!whereClauses) {
      return `-- Unable to generate SQL preview for row ${rowId}: row has no primary key`;
    }
    return `UPDATE ${toSqlIdentifier(selectedSchema)}.${toSqlIdentifier(selectedTable)}\nSET ${setClauses.join(", ")}\nWHERE ${whereClauses.join(" AND ")};`;
  };
  const sqlPreview = [
    ...pendingActions.map((action) => action.sql),
    ...Object.entries(pendingChanges).map(([rowId, changes]) =>
      buildUpdateSql(rowId, changes),
    ),
  ].join("\n\n");

  const formatDiffValue = (value: unknown) => {
    if (value === null) return "NULL";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const handleEditorWillMount = React.useCallback(
    (monaco: any) => {
      monaco.editor.defineTheme("studio-dark", getStudioDarkTheme());
      if (customEditorThemes?.length) {
        registerCustomMonacoThemes(
          monaco,
          customEditorThemes.map((t) => ({ id: t.id, theme: undefined })),
        );
      }
    },
    [customEditorThemes],
  );

  React.useEffect(() => {
    if (pendingCount === 0 && isReviewSheetOpen) {
      setIsReviewSheetOpen(false);
    }
  }, [pendingCount, isReviewSheetOpen, setIsReviewSheetOpen]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (isReviewSheetOpen && pendingCount > 0) {
      document.body.setAttribute("data-review-sheet-open", "true");
    } else {
      document.body.removeAttribute("data-review-sheet-open");
    }
    return () => {
      document.body.removeAttribute("data-review-sheet-open");
    };
  }, [isReviewSheetOpen, pendingCount]);

  if (pendingCount === 0) return null;

  return (
    <Sheet open={isReviewSheetOpen} onOpenChange={setIsReviewSheetOpen} modal={false}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="w-9 h-9 text-muted-foreground/40 hover:text-foreground/60 border border-border rounded-lg bg-background/15 hover:bg-background/25"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : (
            <Clock4 className="h-3.5 w-3.5 " />
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        className="flex flex-col p-0 bg-background border-border"
        contained
      >
        <SheetHeader className="p-6 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm">
            Pending Changes
          </SheetTitle>
          <div className="mt-3 grid grid-cols-2 gap-1">
            <Button
              size="sm"
              variant={viewMode === "visual" ? "default" : "ghost"}
              className="h-8 w-full text-xs tracking-wider"
              onClick={() => setViewMode("visual")}
            >
              Visual
            </Button>
            <Button
              size="sm"
              variant={viewMode === "sql" ? "default" : "ghost"}
              className="h-8 w-full text-xs tracking-wider"
              onClick={() => setViewMode("sql")}
            >
              SQL
            </Button>
          </div>
        </SheetHeader>

        <div
          className={`flex-1 overflow-y-auto custom-scrollbar ${viewMode === "sql" ? "p-0" : "p-6"}`}
        >
          {viewMode === "visual" ? (
            <div className="space-y-6">
              {/* Pending Actions Section (DDL) */}
              {pendingActions.length > 0 && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {pendingActions.map((action) => (
                      <div
                        key={action.id}
                        className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3 shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-2 rounded-lg bg-primary/80" />
                            <span className="text-xs font-medium">
                              {action.description}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              setPendingActions((prev) =>
                                prev.filter((a) => a.id !== action.id),
                              );
                            }}
                          >
                            Discard
                          </Button>
                        </div>
                        <div className="overflow-x-auto rounded border border-border/80 bg-muted/30 p-2 font-mono text-xs text-muted-foreground whitespace-pre">
                          {action.sql}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Row Changes Section (DML) */}
              {Object.keys(pendingChanges).length > 0 && (
                <div className="space-y-3">
                  <div className="space-y-4">
                    {Object.entries(pendingChanges).map(([rowId, changes]) => (
                      <div
                        key={rowId}
                        className="space-y-3 overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm"
                      >
                        <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
                          <span
                            className="text-xs font-mono tracking-wider text-muted-foreground truncate max-w-[300px]"
                            title={rowId}
                          >
                            {rowId.startsWith("idx:") ? (
                              <span className="text-destructive flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                No Primary Key
                              </span>
                            ) : (
                              `Row: ${rowId}`
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              setPendingChanges((prev) => {
                                const next = { ...prev };
                                delete next[rowId];
                                return next;
                              });
                            }}
                          >
                            Discard
                          </Button>
                        </div>
                        <div className="space-y-3 p-4 pt-1">
                          {Object.entries(changes).map(([col, val]) => (
                            <div key={col} className="space-y-1">
                              <div className="text-xs font-bold text-muted-foreground tracking-tight">
                                {col}
                              </div>
                              <div className="overflow-hidden rounded border border-border/80 font-mono text-xs">
                                <div className="flex items-start gap-2 border-b border-destructive/15 bg-destructive/10 px-2 py-1 text-destructive">
                                  <span className="shrink-0 w-9 text-xs font-semibold opacity-60">
                                    From
                                  </span>
                                  <span className="break-all whitespace-pre-wrap">
                                    {formatDiffValue(val.old)}
                                  </span>
                                </div>
                                <div className="flex items-start gap-2 bg-success/10 px-2 py-1 text-success">
                                  <span className="shrink-0 w-9 text-xs font-semibold opacity-70">
                                    To
                                  </span>
                                  <span className="break-all whitespace-pre-wrap">
                                    {formatDiffValue(val.new)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full min-h-[300px] w-full">
              <MonacoEditor
                height="100%"
                language="sql"
                theme={resolvedThemeId}
                value={sqlPreview}
                beforeMount={handleEditorWillMount}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize,
                  fontFamily: editorFontFamily || undefined,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  lineNumbers: "off",
                  glyphMargin: false,
                  folding: false,
                  overviewRulerBorder: false,
                  padding: { top: 16, bottom: 16 },
                  wordWrap: "off",
                  tabSize: 2,
                  renderWhitespace: "none",
                  guides: { indentation: false },
                }}
              />
            </div>
          )}
        </div>

        <SheetFooter className="p-6 border-t bg-muted/5 flex flex-row items-center justify-between gap-4 shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              setPendingChanges({});
              setPendingActions([]);
              setIsReviewSheetOpen(false);
            }}
            className="text-xs h-9 rounded-lg"
          >
            Discard All
          </Button>
          <Button
            onClick={handleCommitChanges}
            disabled={loading || pendingCount === 0}
            className="text-xs font-bold tracking-widest gap-2 h-9 px-4 flex-1 sm:flex-none rounded-lg"
          >
            Commit All ({pendingCount})
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
