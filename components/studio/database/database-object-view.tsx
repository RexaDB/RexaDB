"use client";

import { toast } from "sonner";
import { Code2, Copy, Database } from "@/lib/icon-theme/lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MonacoSqlInput } from "@/components/studio/monaco-sql-input";
import { SqlQueryInput } from "@/components/studio/sql-query-input";
import {
  DATABASE_OBJECT_LABELS,
  type DatabaseObjectDetail,
} from "@/lib/studio/database-objects";
import type { SqlEditorEngine } from "@/lib/studio/types";
import type { CustomEditorTheme, MonacoThemeRef } from "@/lib/studio/editor-themes";

export interface DatabaseObjectEditorProps {
  sqlEditorEngine?: SqlEditorEngine;
  fontSize?: number;
  fontFamily?: string;
  themeId?: string;
  appEditorTheme?: MonacoThemeRef | null;
  customEditorThemes?: CustomEditorTheme[];
}

interface DatabaseObjectViewProps {
  object?: DatabaseObjectDetail;
  dbType?: string;
  editor?: DatabaseObjectEditorProps;
  onOpenInEditor: (object: DatabaseObjectDetail) => void;
}

const noop = () => {};

export function DatabaseObjectView({ object, dbType, editor, onOpenInEditor }: DatabaseObjectViewProps) {
  if (!object) {
    return (
      <div className="flex flex-1 items-center justify-center bg-studio-bg text-sm text-muted-foreground">
        This object is no longer available. Open it again from the sidebar.
      </div>
    );
  }

  const qualifiedName = object.schema ? `${object.schema}.${object.name}` : object.name;
  const isRoutine = object.kind === "function" || object.kind === "procedure";
  const title = isRoutine ? `${qualifiedName}(${object.signature ?? ""})` : qualifiedName;
  const handleCopy = async () => {
    await navigator.clipboard.writeText(object.definition);
    toast.success("Definition copied");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-studio-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="min-w-0 truncate font-mono text-sm font-medium text-foreground" title={title}>
          {title}
        </h1>
        <Badge variant="secondary" className="shrink-0">
          {DATABASE_OBJECT_LABELS[object.kind]}
        </Badge>
        {object.definition && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" />
              Copy
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenInEditor(object)}>
              <Code2 className="size-3.5" />
              Open in SQL Editor
            </Button>
          </div>
        )}
      </div>

      {object.metadata.length > 0 && (
        <dl className="flex shrink-0 flex-wrap gap-x-8 gap-y-1 border-b border-border px-4 py-2 text-xs">
          {object.metadata.map(({ label, value }) => (
            <div key={label} className="flex min-w-0 items-baseline gap-1.5">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate font-mono text-foreground" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!object.definition ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <Database className="size-5" />
            No source definition is available for this object.
          </div>
        ) : (editor?.sqlEditorEngine ?? "monaco") === "monaco" ? (
          <MonacoSqlInput
            dbType={dbType ?? "postgres"}
            query={object.definition}
            fontSize={editor?.fontSize ?? 13}
            fontFamily={editor?.fontFamily ?? ""}
            themeId={editor?.themeId ?? "auto"}
            schemaData={{}}
            onChange={noop}
            onRun={noop}
            onRunSelected={noop}
            onSaveSnippet={noop}
            onSelectionChange={noop}
            appEditorTheme={editor?.appEditorTheme ?? null}
            customEditorThemes={editor?.customEditorThemes ?? []}
            readOnly
          />
        ) : (
          <SqlQueryInput
            dbType={dbType ?? "postgres"}
            query={object.definition}
            fontSize={editor?.fontSize ?? 13}
            fontFamily={editor?.fontFamily ?? ""}
            schemaData={{}}
            onChange={noop}
            onRun={noop}
            onRunSelected={noop}
            onSaveSnippet={noop}
            onSelectionChange={noop}
            readOnly
          />
        )}
      </div>
    </div>
  );
}
