"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "@/lib/icon-theme/lucide-react";

import { SqlEditor } from "@/components/studio/sql-editor";
import { SnippetBrowser } from "@/components/studio/snippet-browser";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  SqlEditorEngine,
  SqlEditorCommonProps,
  SqlFormatSettingsRequired,
} from "@/lib/studio/types";
import { getEditorLabel } from "@/lib/studio/db-labels";
import { useResizePanel } from "@/hooks/use-resize-panel";

interface SqlEditorPanelProps
  extends SqlEditorCommonProps, Partial<SqlFormatSettingsRequired> {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  connectionId: number;
  connectionString: string;
  dbType:
    | "postgres"
    | "mongodb"
    | "sqlite"
    | "mysql"
    | "clickhouse"
    | "mssql"
    | "redis"
    | "trino"
    | "duckdb"
    | "spacetimedb";
  executionTime: number;
  sqlEditorEngine: SqlEditorEngine;
  editorFontSize: number | string;
  editorFontFamily: string;
  editorThemeId: string;
  customEditorThemes: any[];
  appEditorTheme: any;
  sleek?: boolean;
  schemaData: Record<string, any>;
  gridProps: Record<string, any>;
  vimMode?: boolean;
  /**
   * When true, render only the panel body (no outer chrome/resize). Used by
   * Modern UI which places this in an in-flow column like the AI chat panel.
   */
  embedded?: boolean;
}

type ViewMode = "editor" | "snippets";

export function SqlEditorPanel({
  isOpen,
  onOpenChange,
  dbType,
  sleek,
  setQuery,
  embedded = false,
  ...editorProps
}: SqlEditorPanelProps) {
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");

  const { width, isResizeHovered, resizeHandleProps } = useResizePanel({
    ariaLabel: "Resize SQL editor",
    onResizeComplete: () => setLayoutVersion((current) => current + 1),
  });

  useEffect(() => {
    if (!isOpen) return;
    setLayoutVersion((current) => current + 1);
  }, [isOpen]);

  const handleSelectSnippet = useCallback(
    (snippet: { query: string }) => {
      setQuery(snippet.query);
      setViewMode("editor");
    },
    [setQuery],
  );

  if (!isOpen) return null;

  const panelBody = (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden text-foreground",
        embedded ? "bg-transparent" : "bg-background",
      )}
    >
      {/* Header with tabs */}
      <div className="flex h-[44px] shrink-0 items-center border-b border-border px-1">
        <div className="flex h-full items-stretch">
          <button
            type="button"
            onClick={() => setViewMode("editor")}
            className={cn(
              "flex items-center px-3 text-xs font-medium border-b-2 transition-colors",
              viewMode === "editor"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {getEditorLabel(dbType)}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("snippets")}
            className={cn(
              "flex items-center px-3 text-xs font-medium border-b-2 transition-colors",
              viewMode === "snippets"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Snippets
            {editorProps.snippets?.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground/60">
                ({editorProps.snippets.length})
              </span>
            )}
          </button>
        </div>

        <Button
          className="ml-auto h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          onClick={() => onOpenChange(false)}
          size="icon"
          variant="ghost"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {viewMode === "editor" ? (
          <SqlEditor
            dbType={dbType}
            layoutVersion={layoutVersion}
            setQuery={setQuery}
            {...editorProps}
          />
        ) : (
          <SnippetBrowser
            snippets={editorProps.snippets}
            folders={editorProps.folders}
            onSelectSnippet={handleSelectSnippet}
            onAddSnippet={editorProps.addSnippet}
            onUpdateSnippet={editorProps.updateSnippet}
            onDeleteSnippet={editorProps.deleteSnippet}
            onAddFolder={editorProps.addFolder}
            onUpdateFolder={editorProps.updateFolder}
            onDeleteFolder={editorProps.deleteFolder}
            currentQuery={editorProps.query}
          />
        )}
      </div>
    </div>
  );

  if (embedded) {
    return panelBody;
  }

  return (
    <aside
      className={cn(
        "relative h-full shrink-0 border-l bg-background text-foreground shadow-xl transition-all",
        isResizeHovered ? "border-blue-500/60" : "border-border/60",
        sleek &&
          "rounded-lg border border-studio-border/80 overflow-hidden shadow-sm",
      )}
      style={{ width }}
    >
      <div {...resizeHandleProps} />
      {panelBody}
    </aside>
  );
}
