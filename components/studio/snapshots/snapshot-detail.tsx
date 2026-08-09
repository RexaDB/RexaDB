"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Database,
  Table2,
  Eye,
  Code,
  ExternalLink,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DatabaseSnapshot } from "@/lib/db/snapshot-types";

interface SnapshotDetailProps {
  snapshot: DatabaseSnapshot;
  onBack: () => void;
  onCompare: (snapshotId: string) => void;
  onOpenSnapshotTable: (
    tableRef: string,
    columns: { name: string; dataType: string }[],
    rows: Record<string, unknown>[],
    snapshotName: string,
  ) => void;
}

export function SnapshotDetail({
  snapshot,
  onBack,
  onCompare,
  onOpenSnapshotTable,
}: SnapshotDetailProps) {
  const [showSchema, setShowSchema] = useState(false);
  const [showData, setShowData] = useState(false);
  const { meta } = snapshot;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-studio-border shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{meta.name}</p>
          <p className="text-xs text-muted-foreground">{meta.id}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => onCompare(meta.id)}
        >
          <Eye className="w-3 h-3 mr-1" /> Compare...
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        <Card className="border-border/60 bg-studio-bg/40 p-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Created</p>
              <p>{new Date(meta.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Engine</p>
              <p className="capitalize">{meta.engine}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tables</p>
              <p>{meta.tableCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Rows</p>
              <p>{meta.rowCount.toLocaleString()}</p>
            </div>
          </div>
          {meta.description && (
            <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-studio-border/40">
              {meta.description}
            </p>
          )}
        </Card>

        <Card className="border-border/60 bg-studio-bg/40 p-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs w-full justify-start"
            onClick={() => setShowSchema(!showSchema)}
          >
            <Code className="w-3 h-3 mr-2" />
            Schema SQL ({snapshot.schemaStructured.tables.length} tables)
          </Button>
          {showSchema && (
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-background/70 p-3 text-xs font-mono leading-5 custom-scrollbar">
              {snapshot.schemaSQL || "-- No schema SQL available --"}
            </pre>
          )}
        </Card>

        <Card className="border-border/60 bg-studio-bg/40 p-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs w-full justify-start"
            onClick={() => setShowData(!showData)}
          >
            <Table2 className="w-3 h-3 mr-2" />
            Data SQL ({meta.rowCount.toLocaleString()} rows)
          </Button>
          {showData && (
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-background/70 p-3 text-xs font-mono leading-5 custom-scrollbar">
              {snapshot.dataSQL || "-- No data SQL available --"}
            </pre>
          )}
        </Card>

        <Card className="border-border/60 bg-studio-bg/40 p-3">
          <p className="text-xs font-bold tracking-wider text-muted-foreground mb-2">
            Tables
          </p>
          <div className="space-y-1">
            {snapshot.schemaStructured.tables.map((t) => {
              const tableRef = `${t.schema}.${t.name}`;
              const rows = snapshot.dataTables[tableRef] || [];
              return (
                <div
                  key={tableRef}
                  className="flex items-center gap-2 text-xs py-0.5"
                >
                  <Database className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="font-mono">{tableRef}</span>
                  <span className="text-muted-foreground ml-auto">
                    {t.columns.length} cols · {rows.length} rows
                  </span>
                  {rows.length > 0 && (
                    <button
                      onClick={() =>
                        onOpenSnapshotTable(
                          tableRef,
                          t.columns.map((c) => ({
                            name: c.name,
                            dataType: c.dataType,
                          })),
                          rows,
                          snapshot.meta.name,
                        )
                      }
                      className="p-0.5 hover:bg-studio-border/40 rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Open in new tab"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
