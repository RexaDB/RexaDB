"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ErdTable } from "@/lib/studio/erd-storage";
import type { SchemaDiagramRelationship } from "@/components/studio/database/schema-diagram";

export function ErdEditRelationshipDialog({
  open,
  onOpenChange,
  tables,
  initial,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: ErdTable[];
  initial: SchemaDiagramRelationship | null;
  onSave: (rel: SchemaDiagramRelationship) => void;
  onDelete: (rel: SchemaDiagramRelationship) => void;
}) {
  const [sourceTable, setSourceTable] = useState("");
  const [sourceColumn, setSourceColumn] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [targetColumn, setTargetColumn] = useState("");

  useEffect(() => {
    if (!open || !initial) return;
    setSourceTable(initial.sourceTable);
    setSourceColumn(initial.sourceColumn);
    setTargetTable(initial.targetTable);
    setTargetColumn(initial.targetColumn);
  }, [open, initial]);

  const sourceCols = useMemo(
    () => tables.find((t) => t.name === sourceTable)?.columns ?? [],
    [tables, sourceTable],
  );
  const targetCols = useMemo(
    () => tables.find((t) => t.name === targetTable)?.columns ?? [],
    [tables, targetTable],
  );

  if (!initial) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit relationship</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">From table</span>
            <Select
              value={sourceTable}
              onValueChange={(v) => {
                setSourceTable(v);
                setSourceColumn("");
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Table" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">From column</span>
            <Select value={sourceColumn} onValueChange={setSourceColumn}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Column" />
              </SelectTrigger>
              <SelectContent>
                {sourceCols.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">To table</span>
            <Select
              value={targetTable}
              onValueChange={(v) => {
                setTargetTable(v);
                setTargetColumn("");
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Table" />
              </SelectTrigger>
              <SelectContent>
                {tables
                  .filter((t) => t.name !== sourceTable)
                  .map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">To column</span>
            <Select value={targetColumn} onValueChange={setTargetColumn}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Column" />
              </SelectTrigger>
              <SelectContent>
                {targetCols.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(initial);
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
          <Button
            size="sm"
            disabled={
              !sourceTable || !sourceColumn || !targetTable || !targetColumn
            }
            onClick={() => {
              onSave({
                sourceTable,
                sourceColumn,
                targetTable,
                targetColumn,
              });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
