"use client";

import { ExternalLink, Play } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import { StudioTooltip } from "@/components/studio/studio-tooltip";
import { highlightSql } from "@/lib/ai/sql-highlight";

interface AiSqlBlockProps {
  query: string;
  onOpenInEditor: (query: string) => void;
  onRun?: (query: string) => void;
}

export function AiSqlBlock({ query, onOpenInEditor, onRun }: AiSqlBlockProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
        <span className="text-xs font-semiboldtracking-[0.18em] text-muted-foreground">
          SQL
        </span>

        <div className="flex items-center gap-1">
          <StudioTooltip label="Open in Editor">
            <Button
              className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onOpenInEditor(query)}
              size="xs"
              variant="ghost"
            >
              <ExternalLink className="h-3 w-3" />
              Open in Editor
            </Button>
          </StudioTooltip>

          {onRun ? (
            <StudioTooltip label="Run Query">
              <Button
                className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onRun(query)}
                size="xs"
                variant="ghost"
              >
                <Play className="h-3 w-3" />
                Run
              </Button>
            </StudioTooltip>
          ) : null}
        </div>
      </div>

      <pre className="overflow-x-auto bg-background px-2.5 py-2 font-mono text-xs leading-5">
        <code>{highlightSql(query)}</code>
      </pre>
    </div>
  );
}
