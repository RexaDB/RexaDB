"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Upload, FileUp, Loader2, CheckCircle2 } from "@/lib/icon-theme/lucide-react";

interface ImportExportViewProps {
  studio: {
    handleExportDatabaseBundle: (
      format: "sql" | "json" | "csv",
    ) => Promise<void>;
    handleImportDatabaseBundle: (
      file: File,
      format: "sql" | "json" | "csv",
    ) => Promise<void>;
    isImportExportLoading: boolean;
    importExportProgress: {
      title: string;
      steps: string[];
      currentStep: number;
    } | null;
  };
}

export function ImportExportView({ studio }: ImportExportViewProps) {
  const [importFormat, setImportFormat] = useState<"sql" | "json" | "csv">(
    "sql",
  );
  const [file, setFile] = useState<File | null>(null);
  const progress = studio.importExportProgress;

  return (
    <div className="flex-1 overflow-auto bg-background text-foreground h-full">
      <div className="max-w-3xl mx-auto py-12 px-6 space-y-10">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Export</h2>
          <p className="text-xs text-muted-foreground">
            Export schema as SQL or export data as JSON/CSV.
          </p>
        </section>

        {studio.isImportExportLoading && progress && (
          <section className="space-y-3 border border-border rounded-lg p-5 bg-secondary/20">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <h3 className="text-sm font-semibold">{progress.title}</h3>
            </div>
            <div className="space-y-1.5">
              {progress.steps.map((step, index) => {
                const isDone = index < progress.currentStep;
                const isActive = index === progress.currentStep;
                return (
                  <div key={step} className="flex items-center gap-2 text-xs">
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : isActive ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-lg border border-muted-foreground/30" />
                    )}
                    <span
                      className={
                        isDone || isActive
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-4 border border-border rounded-lg p-5 bg-secondary/20">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-semibold">Export Schema / Data</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            SQL exports schema definitions. JSON and CSV export database data.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => studio.handleExportDatabaseBundle("sql")}
              disabled={studio.isImportExportLoading}
              className="gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Export SQL
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => studio.handleExportDatabaseBundle("json")}
              disabled={studio.isImportExportLoading}
              className="gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => studio.handleExportDatabaseBundle("csv")}
              disabled={studio.isImportExportLoading}
              className="gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </Button>
          </div>
        </section>

        <section className="space-y-4 border border-border rounded-lg p-5 bg-secondary/20">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Import Full Database</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Import will replace current schemas/data with the uploaded backup.
          </p>

          <div className="space-y-2">
            <Label className="text-xs">Import Format</Label>
            <div className="flex items-center gap-2">
              {(["sql", "json", "csv"] as const).map((f) => (
                <Button
                  key={f}
                  type="button"
                  size="sm"
                  variant={importFormat === f ? "default" : "secondary"}
                  className="uppercase text-xs"
                  onClick={() => setImportFormat(f)}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Backup File</Label>
            <Input
              type="file"
              accept=".sql,.json,.csv,text/sql,application/sql,application/json,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <Button
            size="sm"
            onClick={() =>
              file && studio.handleImportDatabaseBundle(file, importFormat)
            }
            disabled={!file || studio.isImportExportLoading}
            className="gap-2"
            variant="destructive"
          >
            <FileUp className="w-3.5 h-3.5" />
            Import And Recreate
          </Button>
        </section>
      </div>
    </div>
  );
}
