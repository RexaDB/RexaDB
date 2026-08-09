// fallow-ignore-file code-duplication
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Database,
  Plus,
  Trash2,
  Loader2,
  CheckSquare,
  Square,
  Link as LinkIcon,
  Hash,
} from "@/lib/icon-theme/lucide-react";
import { ConnectionDbType } from "@/lib/db/connection-type";
import {
  POSTGRES_COLUMN_TYPES,
  SQLITE_COLUMN_TYPES,
  MYSQL_COLUMN_TYPES,
  MSSQL_COLUMN_TYPES,
  CLICKHOUSE_COLUMN_TYPES,
  SPACETIMEDB_COLUMN_TYPES,
} from "@/lib/db/column-types";

interface ColumnDefinition {
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable: boolean;
  isUnique: boolean;
  default: string;
  references?: {
    table: string;
    column: string;
  };
}

interface CreateTableViewProps {
  dbType: ConnectionDbType;
  schemas: string[];
  selectedSchema: string;
  tables: string[];
  onCreateTable: (
    name: string,
    schema: string,
    columns: any[],
  ) => Promise<void>;
  isCreating: boolean;
  newTableData: { name: string; columns: ColumnDefinition[] };
  setNewTableData: React.Dispatch<
    React.SetStateAction<{ name: string; columns: ColumnDefinition[] }>
  >;
}

export function CreateTableView({
  dbType,
  schemas,
  selectedSchema,
  tables,
  onCreateTable,
  isCreating,
  newTableData,
  setNewTableData,
}: CreateTableViewProps) {
  const isMongo = dbType === "mongodb";
  const isSpacetimedb = dbType === "spacetimedb";
  const isSqlite = dbType === "sqlite";
  const isMysql = dbType === "mysql";
  const isClickhouse = dbType === "clickhouse";
  const isMssql = dbType === "mssql";
  const newTableName = newTableData.name;
  const newTableColumns = newTableData.columns;

  const [targetSchema, setTargetSchema] = useState(selectedSchema);

  const setNewTableName = (name: string) => {
    setNewTableData((prev) => ({ ...prev, name }));
  };

  const setNewTableColumns = (
    columns:
      | ColumnDefinition[]
      | ((prev: ColumnDefinition[]) => ColumnDefinition[]),
  ) => {
    setNewTableData((prev) => ({
      ...prev,
      columns: typeof columns === "function" ? columns(prev.columns) : columns,
    }));
  };

  const addColumn = () => {
    const defaultType = isSpacetimedb
      ? SPACETIMEDB_COLUMN_TYPES[0] || "string"
      : isSqlite
        ? SQLITE_COLUMN_TYPES[0] || "TEXT"
        : isMysql
          ? MYSQL_COLUMN_TYPES[0] || "VARCHAR"
          : isMssql
            ? MSSQL_COLUMN_TYPES[0] || "INT"
            : isClickhouse
              ? CLICKHOUSE_COLUMN_TYPES[0] || "String"
              : POSTGRES_COLUMN_TYPES[0] || "TEXT";
    setNewTableColumns([
      ...newTableColumns,
      {
        name: "",
        type: defaultType,
        isPrimary: false,
        isNullable: true,
        isUnique: false,
        default: "",
      },
    ]);
  };

  const removeColumn = (index: number) => {
    if (newTableColumns.length <= 1) return;
    setNewTableColumns(newTableColumns.filter((_, i) => i !== index));
  };

  // fallow-ignore-next-line code-duplication
  const updateColumn = (index: number, updates: Partial<ColumnDefinition>) => {
    const updated = [...newTableColumns];
    updated[index] = { ...updated[index], ...updates };
    if (updates.isPrimary) {
      updated.forEach((col, i) => {
        if (i !== index) col.isPrimary = false;
      });
    }
    setNewTableColumns(updated);
  };

  const handleSubmit = () => {
    if (isMongo) {
      onCreateTable(newTableName, targetSchema, []);
      return;
    }

    const formattedColumns = newTableColumns.map((col) => ({
      name: col.name,
      type: col.type,
      notNull: !col.isNullable,
      primaryKey: col.isPrimary,
      unique: col.isUnique,
      defaultValue: col.default,
      foreignKey: col.references
        ? {
            schema: targetSchema,
            table: col.references.table,
            column: col.references.column,
          }
        : undefined,
    }));
    onCreateTable(newTableName, targetSchema, formattedColumns);
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-6 border-b border-border bg-muted/30">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {isMongo ? "Create a new collection" : "Create a new table"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isMongo ? (
                <>
                  Create a collection in{" "}
                  <span className="text-foreground font-mono font-bold bg-muted px-1 rounded">
                    {selectedSchema}
                  </span>
                  . Documents are schema-flexible and can have varying fields.
                </>
              ) : (
                <>
                  Define columns and constraints for your new table in{" "}
                  <span className="text-foreground font-mono font-bold bg-muted px-1 rounded">
                    {selectedSchema}
                  </span>
                  .
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSubmit}
              disabled={!newTableName.trim() || isCreating}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-6 text-xs font-bold"
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : isMongo ? (
                "Create Collection"
              ) : (
                "Create Table"
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <Label className="text-xs tracking-wider text-muted-foreground">
                {isMongo ? "Database" : "Schema"}
              </Label>
              <Select value={targetSchema} onValueChange={setTargetSchema}>
                <SelectTrigger className="bg-secondary/30 border-border h-10 text-xs">
                  <SelectValue placeholder="Select schema" />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label
                htmlFor="tableName"
                className="text-xs tracking-wider text-muted-foreground"
              >
                {isMongo ? "Collection Name" : "Table Name"}
              </Label>
              <Input
                id="tableName"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder={isMongo ? "e.g. customers" : "e.g. customers"}
                className="bg-secondary/30 border-border text-foreground focus-visible:ring-blue-500/50 h-10 text-xs"
              />
            </div>
          </div>

          {!isMongo && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <Label className="text-xs tracking-wider text-muted-foreground">
                  Columns
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addColumn}
                  className="h-7 text-xs gap-1.5 text-blue-500 hover:text-blue-600 hover:bg-blue-500/5"
                >
                  <Plus className="w-3 h-3" />
                  Add column
                </Button>
              </div>

              <div className="space-y-3">
                {newTableColumns.map((col, idx) => (
                  <div
                    key={idx}
                    className="group relative flex flex-col lg:flex-row lg:items-end gap-4 p-4 rounded-lg border border-border bg-muted/20 transition-all hover:bg-muted/30"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-end gap-4 flex-1 min-w-0">
                      <div className="flex-[2] min-w-0 w-full space-y-1.5">
                        <Label className="text-xs text-muted-foregroundtracking-tight font-semibold">
                          Name
                        </Label>
                        <Input
                          value={col.name}
                          onChange={(e) =>
                            updateColumn(idx, { name: e.target.value })
                          }
                          className="h-9 text-xs bg-background border-border focus-visible:ring-blue-500/50 w-full"
                          placeholder="column_name"
                        />
                      </div>
                      <div className="flex-[3] min-w-0 w-full space-y-1.5">
                        <Label className="text-xs text-muted-foregroundtracking-tight font-semibold">
                          Type
                        </Label>
                        <Select
                          value={col.type}
                          onValueChange={(v) => updateColumn(idx, { type: v })}
                        >
                          <SelectTrigger className="h-9 text-xs bg-background border-border focus:ring-blue-500/50 w-full overflow-hidden">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(isSpacetimedb
                              ? SPACETIMEDB_COLUMN_TYPES
                              : isSqlite
                                ? SQLITE_COLUMN_TYPES
                                : isMysql
                                  ? MYSQL_COLUMN_TYPES
                                  : isMssql
                                    ? MSSQL_COLUMN_TYPES
                                    : isClickhouse
                                      ? CLICKHOUSE_COLUMN_TYPES
                                      : POSTGRES_COLUMN_TYPES
                            ).map((t) => (
                              <SelectItem key={t} value={t} className="text-xs">
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-[2] min-w-0 w-full space-y-1.5">
                        <Label className="text-xs text-muted-foregroundtracking-tight font-semibold">
                          Default
                        </Label>
                        <Input
                          value={col.default}
                          onChange={(e) =>
                            updateColumn(idx, { default: e.target.value })
                          }
                          className="h-9 text-xs bg-background border-border font-mono focus-visible:ring-blue-500/50 w-full"
                          placeholder="NULL"
                        />
                      </div>
                      {/* Foreign Key Support */}
                      <div className="flex-[3] min-w-0 w-full space-y-1.5">
                        <Label className="text-xs text-muted-foregroundtracking-tight font-semibold flex items-center gap-1">
                          <LinkIcon className="w-2.5 h-2.5" /> Foreign Key
                        </Label>
                        <div className="flex gap-1.5">
                          <Select
                            value={col.references?.table || "none"}
                            onValueChange={(v) => {
                              if (v === "none") {
                                const { references, ...rest } = col;
                                updateColumn(idx, {
                                  ...rest,
                                  references: undefined,
                                });
                              } else {
                                updateColumn(idx, {
                                  references: {
                                    table: v,
                                    column: col.references?.column || "id",
                                  },
                                });
                              }
                            }}
                          >
                            <SelectTrigger className="h-9 text-xs bg-background border-border focus:ring-blue-500/50 w-full overflow-hidden">
                              <SelectValue placeholder="No reference" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none" className="text-xs">
                                No reference
                              </SelectItem>
                              {tables
                                .filter((t) => t !== newTableName)
                                .map((t) => (
                                  <SelectItem
                                    key={t}
                                    value={t}
                                    className="text-xs"
                                  >
                                    {t}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>

                          {col.references && (
                            <Input
                              value={col.references.column}
                              onChange={(e) =>
                                updateColumn(idx, {
                                  references: {
                                    ...col.references!,
                                    column: e.target.value,
                                  },
                                })
                              }
                              className="h-9 text-xs bg-background border-border focus-visible:ring-blue-500/50 w-24"
                              placeholder="column"
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end lg:self-auto mt-2 lg:mt-0">
                      <div className="flex items-center bg-background rounded-lg border border-border p-1 gap-1">
                        <button
                          onClick={() =>
                            updateColumn(idx, { isPrimary: !col.isPrimary })
                          }
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors ${col.isPrimary ? "text-yellow-500 bg-yellow-500/10" : "text-muted-foreground hover:bg-muted"}`}
                          title="Primary Key"
                        >
                          <Database className="w-3.5 h-3.5" />
                          <span className="text-xs font-boldtracking-tight">
                            PK
                          </span>
                        </button>

                        <div className="w-px h-4 bg-border" />

                        <button
                          onClick={() =>
                            updateColumn(idx, { isNullable: !col.isNullable })
                          }
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors ${!col.isNullable ? "text-blue-500 bg-blue-500/10" : "text-muted-foreground hover:bg-muted"}`}
                          title={col.isNullable ? "Allow NULL" : "NOT NULL"}
                        >
                          {col.isNullable ? (
                            <Square className="w-3.5 h-3.5" />
                          ) : (
                            <CheckSquare className="w-3.5 h-3.5" />
                          )}
                          <span className="text-xs font-boldtracking-tight">
                            NotNull
                          </span>
                        </button>

                        <div className="w-px h-4 bg-border" />

                        <button
                          onClick={() =>
                            updateColumn(idx, { isUnique: !col.isUnique })
                          }
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors ${col.isUnique ? "text-purple-500 bg-purple-500/10" : "text-muted-foreground hover:bg-muted"}`}
                          title="Unique Constraint"
                        >
                          <Hash className="w-3.5 h-3.5" />
                          <span className="text-xs font-boldtracking-tight">
                            Unique
                          </span>
                        </button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeColumn(idx)}
                        className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                        disabled={newTableColumns.length === 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
