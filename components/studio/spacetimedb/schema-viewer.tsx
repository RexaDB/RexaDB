"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Eye, Copy, Check } from "@/lib/icon-theme/lucide-react";
import { PanelRefreshButtons, PanelLoadingError } from "./panel-shared";
import { fetchSchema } from "@/lib/db/spacetimedb-client";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export function SpacetimeDbSchemaViewer({
  connectionString,
  onClose,
  editorThemeId,
  appEditorTheme,
}: {
  connectionString: string;
  onClose?: () => void;
  editorThemeId?: string;
  appEditorTheme?: any;
}) {
  const [schema, setSchema] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSchema = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const def = await fetchSchema(connectionString);
      setSchema(def);
    } catch (err: any) {
      setError(err.message || "Failed to load schema");
    } finally {
      setLoading(false);
    }
  }, [connectionString]);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  const handleCopy = useCallback(() => {
    if (!schema) return;
    navigator.clipboard.writeText(JSON.stringify(schema, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [schema]);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Eye className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Schema</span>
        <span className="text-xs text-muted-foreground">raw module definition</span>
        <div className="flex-1" />
        {schema && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        )}
        <PanelRefreshButtons loading={loading} onRefresh={loadSchema} onClose={onClose} />
      </div>

      {loading || error ? (
        <PanelLoadingError loading={loading} error={error} onRetry={loadSchema} loadingLabel="Loading schema..." />
      ) : (
        <div className="flex-1">
          <MonacoEditor
            defaultLanguage="json"
            value={JSON.stringify(schema, null, 2)}
            theme={editorThemeId === "custom" ? "customTheme" : "vs-dark"}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: "Geist Mono, monospace",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              tabSize: 2,
            }}
          />
        </div>
      )}
    </div>
  );
}
