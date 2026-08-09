"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, AlertTriangle } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Connection } from "@/lib/db/schema";
import { detectConnectionDbType } from "@/lib/db/connection-type";
import { useSchemaCompare } from "@/hooks/use-schema-compare";
import { toast } from "sonner";
import { format } from "sql-formatter";
import { highlightSql } from "@/lib/ai/sql-highlight";

// Kept in one file for now to avoid deeper component sprawl in the connections flow.
export function ConnectionSchemaCompareScreen({
  connections,
  onBack,
}: {
  connections: Connection[];
  onBack: () => void;
}) {
  const postgresConnections = useMemo(
    () =>
      connections.filter(
        (conn) => detectConnectionDbType(conn.connectionString) === "postgres",
      ),
    [connections],
  );
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const {
    loading,
    applying,
    error,
    result,
    runCompare,
    applySourceToTarget,
    reset,
  } = useSchemaCompare();

  const sourceConnection =
    postgresConnections.find((conn) => conn.id === sourceId) ?? null;
  const targetConnection =
    postgresConnections.find((conn) => conn.id === targetId) ?? null;

  const formatSqlBlock = useCallback((statements: string[]) => {
    if (statements.length === 0) return "";
    const raw = statements.map((stmt) => `${stmt};`).join("\n\n");
    try {
      return format(raw, { language: "postgresql" });
    } catch {
      return raw;
    }
  }, []);

  const formattedMissing = useMemo(
    () => (result ? formatSqlBlock(result.missingInTarget) : ""),
    [formatSqlBlock, result],
  );
  const formattedExtra = useMemo(
    () => (result ? formatSqlBlock(result.extraInTarget) : ""),
    [formatSqlBlock, result],
  );

  const handleCompare = async () => {
    if (!sourceConnection || !targetConnection) {
      toast.error("Select two PostgreSQL connections to compare.");
      return;
    }
    if (sourceConnection.id === targetConnection.id) {
      toast.error("Choose two different connections.");
      return;
    }
    const ok = await runCompare(
      sourceConnection.connectionString,
      targetConnection.connectionString,
    );
    if (ok) toast.success("Schema comparison complete.");
  };

  const handleApply = async () => {
    if (!sourceConnection || !targetConnection) return;
    const { ok, appliedCount } = await applySourceToTarget(
      sourceConnection.connectionString,
      targetConnection.connectionString,
    );
    if (ok) {
      toast.success(
        appliedCount
          ? `Applied ${appliedCount} statements.`
          : "Schema already up to date.",
      );
      void runCompare(
        sourceConnection.connectionString,
        targetConnection.connectionString,
      );
    }
    setConfirmOpen(false);
  };

  const resetSelection = () => {
    setSourceId(null);
    setTargetId(null);
    reset();
  };

  const options = postgresConnections.map((conn) => ({
    value: String(conn.id),
    label: conn.name,
  }));

  return (
    <div className="flex h-full w-full max-w-none mx-auto flex-col px-6 py-8 text-foreground min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-visible scrollbar-hide pb-8 px-2">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={onBack}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h2 className="text-sm font-bold tracking-tight">
                Compare Schemas
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                Compare two PostgreSQL connections and optionally apply schema
                changes.
              </p>
            </div>
          </div>
        </div>

        <Card className="border-border/60 bg-studio-bg/40 p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Source (authoritative)
              </Label>
              <SearchableSelect
                value={sourceId ? String(sourceId) : ""}
                onValueChange={(value) =>
                  setSourceId(value ? Number(value) : null)
                }
                placeholder="Select source connection"
                options={options}
                searchThreshold={0}
                className="h-9 w-full border-border/60 bg-background text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Target (to update)</Label>
              <SearchableSelect
                value={targetId ? String(targetId) : ""}
                onValueChange={(value) =>
                  setTargetId(value ? Number(value) : null)
                }
                placeholder="Select target connection"
                options={options}
                searchThreshold={0}
                className="h-9 w-full border-border/60 bg-background text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleCompare}
              disabled={loading || postgresConnections.length < 2}
            >
              {loading ? "Comparing..." : "Compare Schemas"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={resetSelection}
            >
              Reset
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {postgresConnections.length < 2 && (
            <p className="text-xs text-muted-foreground">
              Add at least two PostgreSQL connections to compare schemas.
            </p>
          )}
        </Card>

        {result && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="border-border/60 bg-studio-bg/40 p-3">
                <p className="text-xstracking-[0.14em] text-muted-foreground">
                  Source Statements
                </p>
                <p className="text-sm font-semibold">{result.sourceCount}</p>
              </Card>
              <Card className="border-border/60 bg-studio-bg/40 p-3">
                <p className="text-xstracking-[0.14em] text-muted-foreground">
                  Target Statements
                </p>
                <p className="text-sm font-semibold">{result.targetCount}</p>
              </Card>
              <Card className="border-border/60 bg-studio-bg/40 p-3">
                <p className="text-xstracking-[0.14em] text-muted-foreground">
                  Status
                </p>
                <p className="text-sm font-semibold">
                  {result.isEqual ? "Match" : "Differences"}
                </p>
              </Card>
            </div>

            {!result.isEqual ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  This comparison uses schema statements from `pg_dump` and
                  ignores data. Applying changes will run only missing
                  statements on the target.
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Card className="border-border/60 bg-studio-bg/40 p-3">
                    <p className="text-xstracking-[0.14em] text-muted-foreground mb-2">
                      Will Apply
                    </p>
                    <pre className="max-h-[280px] overflow-auto rounded-lg bg-background/70 p-3 text-xs leading-5">
                      <code>
                        {formattedMissing
                          ? highlightSql(formattedMissing)
                          : "No missing statements."}
                      </code>
                    </pre>
                  </Card>
                  <Card className="border-border/60 bg-studio-bg/40 p-3">
                    <p className="text-xstracking-[0.14em] text-muted-foreground mb-2">
                      Only In Target
                    </p>
                    <pre className="max-h-[280px] overflow-auto rounded-lg bg-background/70 p-3 text-xs leading-5">
                      <code>
                        {formattedExtra
                          ? highlightSql(formattedExtra)
                          : "No extra statements."}
                      </code>
                    </pre>
                  </Card>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-9"
                  disabled={applying}
                  onClick={() => setConfirmOpen(true)}
                >
                  {applying ? "Applying..." : "Apply Source Schema to Target"}
                </Button>
              </div>
            ) : (
              <Card className="border-border/60 bg-emerald-500/10 p-3 text-sm text-emerald-700">
                Schemas match. No changes required.
              </Card>
            )}
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border-border bg-studio-bg">
          <DialogHeader>
            <DialogTitle>Apply Source Schema?</DialogTitle>
            <DialogDescription>
              This will drop non-system schemas in the target database and
              recreate them from the source schema. Data is not migrated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleApply}
              disabled={applying}
            >
              {applying ? "Applying..." : "Apply Schema"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
