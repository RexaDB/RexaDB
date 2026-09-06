"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColumnSheetShell } from "@/components/studio/grid/column-sheet-shell";
import { useSheetCloseConfirm } from "@/hooks/use-sheet-close-confirm";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { Plus, Trash2 } from "@/lib/icon-theme/lucide-react";
import type { ConnectionDbType } from "@/lib/db/connection-type";
import {
  POSTGRES_COLUMN_TYPES,
  SQLITE_COLUMN_TYPES,
  MYSQL_COLUMN_TYPES,
  MSSQL_COLUMN_TYPES,
  CLICKHOUSE_COLUMN_TYPES,
  SPACETIMEDB_COLUMN_TYPES,
} from "@/lib/db/column-types";
import type { ErdColumn, ErdTable } from "@/lib/studio/erd-storage";

function typeOptionsFor(dbType: ConnectionDbType): string[] {
  if (dbType === "sqlite") return SQLITE_COLUMN_TYPES;
  if (dbType === "mysql") return MYSQL_COLUMN_TYPES;
  if (dbType === "mssql") return MSSQL_COLUMN_TYPES;
  if (dbType === "clickhouse") return CLICKHOUSE_COLUMN_TYPES;
  if (dbType === "spacetimedb") return SPACETIMEDB_COLUMN_TYPES;
  return POSTGRES_COLUMN_TYPES;
}

export function ErdEditTableSheet({
  open,
  onOpenChange,
  schemaName,
  dbType = "postgres",
  initial,
  existingNames,
  tables = [],
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schemaName: string;
  dbType?: ConnectionDbType;
  initial?: ErdTable | null;
  existingNames: string[];
  /** Other tables in the ERD (for FK target picks). */
  tables?: ErdTable[];
  onSubmit: (table: ErdTable) => void;
}) {
  const typeOptions = useMemo(() => typeOptionsFor(dbType), [dbType]);
  const defaultType = typeOptions[0] || "TEXT";
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ErdColumn[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setColumns(
        initial.columns.map((c) => ({
          ...c,
          references: c.references ? { ...c.references } : null,
        })),
      );
    } else {
      setName("");
      setColumns([
        {
          name: "id",
          type: typeOptions.includes("UUID")
            ? "UUID"
            : typeOptions.includes("INTEGER")
              ? "INTEGER"
              : defaultType,
          isPrimary: true,
          isNullable: false,
          references: null,
        },
      ]);
    }
    setError(null);
  }, [open, initial, typeOptions, defaultType]);

  const fkTargetTables = useMemo(
    () =>
      tables.filter(
        (t) => t.name.toLowerCase() !== (initial?.name ?? name).toLowerCase(),
      ),
    [tables, initial?.name, name],
  );

  const isDirty = useMemo(() => {
    if (!initial) {
      return name.trim() !== "" || columns.some((c) => c.name.trim() !== "id");
    }
    if (name !== initial.name) return true;
    if (columns.length !== initial.columns.length) return true;
    return columns.some((col, i) => {
      const prev = initial.columns[i];
      if (!prev) return true;
      return (
        col.name !== prev.name ||
        col.type !== prev.type ||
        col.isPrimary !== prev.isPrimary ||
        col.isNullable !== prev.isNullable ||
        col.references?.table !== prev.references?.table ||
        col.references?.column !== prev.references?.column
      );
    });
  }, [columns, initial, name]);

  const { confirmSheetClose } = useGlobalStudioSettings();
  const { handleInteractOutside, ConfirmDialog } = useSheetCloseConfirm(
    isDirty,
    confirmSheetClose,
    () => onOpenChange(false),
  );

  function updateColumn(index: number, patch: Partial<ErdColumn>) {
    setColumns((prev) =>
      prev.map((col, i) => (i === index ? { ...col, ...patch } : col)),
    );
  }

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Table name is required");
      return;
    }
    const conflict = existingNames.some(
      (n) =>
        n.toLowerCase() === trimmed.toLowerCase() &&
        n.toLowerCase() !== (initial?.name ?? "").toLowerCase(),
    );
    if (conflict) {
      setError("A table with this name already exists");
      return;
    }
    if (columns.length === 0) {
      setError("Add at least one column");
      return;
    }
    for (const col of columns) {
      if (!col.name.trim()) {
        setError("Every column needs a name");
        return;
      }
      if (!col.type.trim()) {
        setError("Every column needs a type");
        return;
      }
    }
    const names = columns.map((c) => c.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setError("Column names must be unique");
      return;
    }

    onSubmit({
      schema: schemaName,
      name: trimmed,
      columns: columns.map((c) => ({
        name: c.name.trim(),
        type: c.type.trim(),
        isPrimary: Boolean(c.isPrimary),
        isNullable: c.isPrimary ? false : Boolean(c.isNullable),
        references: c.references,
      })),
    });
    onOpenChange(false);
  }

  return (
    <ColumnSheetShell
      isOpen={open}
      onOpenChange={onOpenChange}
      handleInteractOutside={handleInteractOutside}
      confirmDialog={ConfirmDialog}
      className="bg-background text-foreground flex flex-col p-0 gap-0"
    >
      <SheetHeader className="border-b border-border px-4 py-3">
        <SheetTitle className="text-sm font-medium">
          {initial ? "Edit table" : "Add table"}
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="erd-table-name">Table name</Label>
          <Input
            id="erd-table-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="users"
            className="h-9"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Columns</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() =>
                setColumns((prev) => [
                  ...prev,
                  {
                    name: "",
                    type: defaultType,
                    isPrimary: false,
                    isNullable: true,
                    references: null,
                  },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add column
            </Button>
          </div>
          <div className="space-y-2">
            {columns.map((col, index) => {
              const selectTypes = [
                ...new Set([col.type, ...typeOptions].filter(Boolean)),
              ];
              return (
              <div
                key={index}
                className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2"
              >
                <div className="flex gap-2">
                  <Input
                    value={col.name}
                    onChange={(e) =>
                      updateColumn(index, { name: e.target.value })
                    }
                    placeholder="column"
                    className="h-8 text-sm"
                  />
                  <Select
                    value={col.type}
                    onValueChange={(value) =>
                      updateColumn(index, { type: value })
                    }
                  >
                    <SelectTrigger className="h-8 w-[9.5rem] shrink-0 text-sm font-mono">
                      <SelectValue placeholder="type" />
                    </SelectTrigger>
                    <SelectContent searchThreshold={0}>
                      {selectTypes.map((t) => (
                        <SelectItem key={t} value={t} className="text-sm font-mono">
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      setColumns((prev) => prev.filter((_, i) => i !== index))
                    }
                    aria-label="Remove column"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={col.isPrimary}
                      onCheckedChange={(checked) =>
                        updateColumn(index, {
                          isPrimary: Boolean(checked),
                          isNullable: checked ? false : col.isNullable,
                        })
                      }
                    />
                    Primary
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={col.isNullable}
                      disabled={col.isPrimary}
                      onCheckedChange={(checked) =>
                        updateColumn(index, {
                          isNullable: Boolean(checked),
                        })
                      }
                    />
                    Nullable
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={Boolean(col.references)}
                      disabled={fkTargetTables.length === 0}
                      onCheckedChange={(checked) => {
                        if (!checked) {
                          updateColumn(index, { references: null });
                          return;
                        }
                        const firstTable = fkTargetTables[0];
                        const firstCol =
                          firstTable?.columns.find((c) => c.isPrimary)?.name ||
                          firstTable?.columns[0]?.name ||
                          "";
                        updateColumn(index, {
                          references: firstTable
                            ? {
                                schema: schemaName,
                                table: firstTable.name,
                                column: firstCol,
                              }
                            : null,
                        });
                      }}
                    />
                    Foreign key
                  </label>
                </div>
                {col.references && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        References table
                      </Label>
                      <Select
                        value={col.references.table}
                        onValueChange={(tableName) => {
                          const target = fkTargetTables.find(
                            (t) => t.name === tableName,
                          );
                          const firstCol =
                            target?.columns.find((c) => c.isPrimary)?.name ||
                            target?.columns[0]?.name ||
                            "";
                          updateColumn(index, {
                            references: {
                              schema: schemaName,
                              table: tableName,
                              column: firstCol,
                            },
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Table" />
                        </SelectTrigger>
                        <SelectContent>
                          {fkTargetTables.map((t) => (
                            <SelectItem key={t.name} value={t.name}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        References column
                      </Label>
                      <Select
                        value={col.references.column}
                        onValueChange={(columnName) =>
                          updateColumn(index, {
                            references: col.references
                              ? {
                                  ...col.references,
                                  column: columnName,
                                }
                              : null,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Column" />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            fkTargetTables.find(
                              (t) => t.name === col.references?.table,
                            )?.columns ?? []
                          ).map((c) => (
                            <SelectItem key={c.name} value={c.name}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <SheetFooter className="border-t border-border px-4 py-3 flex-row justify-end gap-2 sm:space-x-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit}>
          {initial ? "Save table" : "Create table"}
        </Button>
      </SheetFooter>
    </ColumnSheetShell>
  );
}
