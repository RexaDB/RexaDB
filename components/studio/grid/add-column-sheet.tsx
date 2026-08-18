"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { detectConnectionDbType } from "@/lib/db/connection-type";
import {
  useColumnSheetCommon,
  useForeignKeyFetchEffects,
  FkActionSelectItems,
  useFkColumnSheetState,
} from "./column-sheet-common";
import type { AddColumnPayload } from "./types";
import { Plus, Loader2, Link as LinkIcon } from "@/lib/icon-theme/lucide-react";
import {
  POSTGRES_COLUMN_TYPES,
  SQLITE_COLUMN_TYPES,
  MYSQL_COLUMN_TYPES,
  MSSQL_COLUMN_TYPES,
  CLICKHOUSE_COLUMN_TYPES,
  SPACETIMEDB_COLUMN_TYPES,
} from "@/lib/db/column-types";

interface AddColumnSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  connectionString: string;
  selectedSchema?: string | null;
  tableName: string;
  onAddColumn: (column: AddColumnPayload) => Promise<void>;
  isAdding: boolean;
}

export function AddColumnSheet({
  isOpen,
  onOpenChange,
  connectionString,
  selectedSchema,
  tableName,
  onAddColumn,
  isAdding,
}: AddColumnSheetProps) {
  const { appShellLayout, modernUiLayout } = useGlobalStudioSettings();
  const shellLayout = appShellLayout || modernUiLayout;
  const dbType = useMemo(
    () => detectConnectionDbType(connectionString),
    [connectionString],
  );
  const isMongo = dbType === "mongodb";
  const isSqlite = dbType === "sqlite";
  const typeOptions = isSqlite
    ? SQLITE_COLUMN_TYPES
    : dbType === "mysql"
      ? MYSQL_COLUMN_TYPES
      : dbType === "mssql"
        ? MSSQL_COLUMN_TYPES
        : dbType === "clickhouse"
          ? CLICKHOUSE_COLUMN_TYPES
          : dbType === "spacetimedb"
            ? SPACETIMEDB_COLUMN_TYPES
            : POSTGRES_COLUMN_TYPES;

  const [name, setName] = useState("");
  const [type, setType] = useState(typeOptions[0] || "TEXT");
  const [isNullable, setIsNullable] = useState(true);
  const [isPrimary, setIsPrimary] = useState(false);
  const [isUnique, setIsUnique] = useState(false);
  const [isArray, setIsArray] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [checkConstraint, setCheckConstraint] = useState("");
  const {
    addForeignKey,
    setAddForeignKey,
    fkSchema,
    setFkSchema,
    fkTable,
    setFkTable,
    fkColumn,
    setFkColumn,
    fkOnUpdate,
    setFkOnUpdate,
    fkOnDelete,
    setFkOnDelete,
    schemas,
    setSchemas,
    fkTables,
    setFkTables,
    fkColumns,
    setFkColumns,
  } = useFkColumnSheetState(selectedSchema);
  const [createMore, setCreateMore] = useState(false);

  const resetForm = (options?: { keepCreateMore?: boolean }) => {
    setName("");
    setType(typeOptions[0] || "TEXT");
    setIsNullable(true);
    setIsPrimary(false);
    setIsUnique(false);
    setIsArray(false);
    setDefaultValue("");
    setCheckConstraint("");
    setAddForeignKey(false);
    setFkSchema(selectedSchema || "");
    setFkTable("");
    setFkColumn("");
    setFkOnUpdate("NO ACTION");
    setFkOnDelete("NO ACTION");
    if (!options?.keepCreateMore) {
      setCreateMore(false);
    }
  };

  useForeignKeyFetchEffects({
    isOpen,
    skip: isMongo,
    addForeignKey,
    fkSchema,
    fkTable,
    connectionString,
    setSchemas,
    setFkTables,
    setFkColumns,
    setFkColumn,
    fkColumn,
  });

  useEffect(() => {
    if (!isOpen) return;
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    const payload: AddColumnPayload = {
      name: name.trim(),
      type,
      isNullable,
      default: defaultValue.trim(),
      isPrimary,
      isUnique,
      isArray,
      checkConstraint: checkConstraint.trim(),
      createMore,
    };

    if (addForeignKey && fkSchema && fkTable && fkColumn) {
      payload.foreignKey = {
        schema: fkSchema,
        table: fkTable,
        column: fkColumn,
        onUpdate: fkOnUpdate,
        onDelete: fkOnDelete,
      };
    }

    await onAddColumn(payload);
    if (createMore) {
      resetForm({ keepCreateMore: true });
      return;
    }
    onOpenChange(false);
  };

  const canSubmit =
    !!name.trim() && (!addForeignKey || !!(fkSchema && fkTable && fkColumn));

  const disablePrimaryAndUnique = isSqlite;

  const isDirty = useMemo(
    () =>
      name !== "" ||
      type !== typeOptions[0] ||
      !isNullable ||
      isPrimary ||
      isUnique ||
      isArray ||
      defaultValue !== "" ||
      checkConstraint !== "" ||
      addForeignKey ||
      createMore,
    [
      name,
      type,
      typeOptions,
      isNullable,
      isPrimary,
      isUnique,
      isArray,
      defaultValue,
      checkConstraint,
      addForeignKey,
      createMore,
    ],
  );

  const { handleInteractOutside, ConfirmDialog, onForeignKeyToggle } =
    useColumnSheetCommon({
      isDirty,
      onOpenChange,
      setAddForeignKey,
      setFkTable,
      setFkColumn,
      setFkSchema,
      selectedSchema,
      schemas,
    });

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange} modal={!shellLayout}>
      <SheetContent
        side="right"
        contained={shellLayout}
        onInteractOutside={handleInteractOutside}
        className={cn("bg-background text-foreground flex flex-col p-0 gap-0", !shellLayout && "h-full w-[min(540px,88vw)] border-border data-[side=right]:sm:max-w-[540px]")}
      >
        {ConfirmDialog}
        <div className="flex flex-col h-full">
          <SheetHeader className="p-4">
            <SheetTitle className="text-sm font-semibold leading-none tracking-tight text-foreground flex items-center gap-1.5">
              {isMongo ? "Add new field" : "Add new column"}
            </SheetTitle>
            <SheetDescription className="pt-0.5 text-xs text-muted-foreground">
              Add a new {isMongo ? "field" : "column"} to{" "}
              <span className="text-foreground font-medium">{tableName}</span>.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-border">
              <section className="grid gap-3 px-4 py-4 lg:grid-cols-[120px_1fr]">
                <div>
                  <h3 className="text-sm font-semibold leading-none text-foreground">
                    General
                  </h3>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="colName"
                      className="text-xs font-medium text-foreground"
                    >
                      {isMongo ? "Field Name" : "Name"}
                    </Label>
                    <Input
                      id="colName"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="column_name"
                      className="bg-muted/20 border-studio-border text-foreground focus-visible:ring-primary/50 h-8 text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Recommended to use lowercase and underscore-separated
                      names.
                    </p>
                  </div>
                </div>
              </section>

              {!isMongo && (
                <section className="grid gap-3 px-4 py-4 lg:grid-cols-[120px_1fr]">
                  <div>
                    <h3 className="text-sm font-semibold leading-none text-foreground">
                      Data Type
                    </h3>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-foreground">
                        Type
                      </Label>
                      <Select value={type} onValueChange={setType}>
                        <SelectTrigger className="bg-muted/20 border-studio-border h-8 text-xs">
                          <SelectValue placeholder="Choose a column type..." />
                        </SelectTrigger>
                        <SelectContent
                          searchThreshold={0}
                          className="bg-studio-bg border-studio-border"
                        >
                          {typeOptions.map((t) => (
                            <SelectItem
                              key={t}
                              value={t}
                              className="hover:bg-studio-row-hover focus:bg-studio-row-hover text-xs"
                            >
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {!isSqlite && (
                      <div className="flex items-start gap-2.5 rounded-lg border border-studio-border bg-muted/10 p-2.5">
                        <Switch
                          checked={isArray}
                          onCheckedChange={(checked) => setIsArray(!!checked)}
                          className="mt-0.5 h-4 w-7 border border-studio-border data-[state=unchecked]:bg-muted/20"
                          thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                        />
                        <div>
                          <div className="text-xs font-medium text-foreground">
                            Define as Array
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Allow this column to store PostgreSQL array values.
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label
                        htmlFor="defaultVal"
                        className="text-xs font-medium text-foreground"
                      >
                        Default Value
                      </Label>
                      <Input
                        id="defaultVal"
                        value={defaultValue}
                        onChange={(e) => setDefaultValue(e.target.value)}
                        placeholder="NULL"
                        className="bg-muted/20 border-studio-border text-foreground focus-visible:ring-primary/50 h-8 font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Can be a literal or expression (example:{" "}
                        <span className="font-mono">gen_random_uuid()</span>).
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {!isMongo && (
                <section className="grid gap-3 px-4 py-4 lg:grid-cols-[120px_1fr]">
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-semibold leading-none text-foreground">
                      Foreign Keys
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Link this column to another table.
                    </p>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border border-studio-border bg-muted/10 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <LinkIcon className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-medium text-foreground">
                          Add foreign key
                        </span>
                      </div>
                      <Switch
                        checked={addForeignKey}
                        onCheckedChange={(checked) =>
                          onForeignKeyToggle(!!checked)
                        }
                        className="h-4 w-7 border border-studio-border data-[state=unchecked]:bg-muted/20"
                        thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                      />
                    </div>

                    {addForeignKey && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-foreground">
                            Schema
                          </Label>
                          <Select
                            value={fkSchema}
                            onValueChange={(value) => {
                              setFkSchema(value);
                              setFkTable("");
                              setFkColumn("");
                            }}
                          >
                            <SelectTrigger className="bg-muted/20 border-studio-border h-8 w-full text-xs">
                              <SelectValue placeholder="Select schema" />
                            </SelectTrigger>
                            <SelectContent className="bg-studio-bg border-studio-border">
                              {schemas.map((schema) => (
                                <SelectItem
                                  key={schema}
                                  value={schema}
                                  className="text-xs"
                                >
                                  {schema}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-foreground">
                            Referenced Table
                          </Label>
                          <Select
                            value={fkTable}
                            onValueChange={(value) => {
                              setFkTable(value);
                              setFkColumn("");
                            }}
                          >
                            <SelectTrigger className="bg-muted/20 border-studio-border h-8 w-full text-xs">
                              <SelectValue placeholder="Select table" />
                            </SelectTrigger>
                            <SelectContent className="bg-studio-bg border-studio-border">
                              {fkTables.map((table) => (
                                <SelectItem
                                  key={table}
                                  value={table}
                                  className="text-xs"
                                >
                                  {table}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-foreground">
                            Referenced Column
                          </Label>
                          <Select value={fkColumn} onValueChange={setFkColumn}>
                            <SelectTrigger className="bg-muted/20 border-studio-border h-8 w-full text-xs">
                              <SelectValue placeholder="Select column" />
                            </SelectTrigger>
                            <SelectContent className="bg-studio-bg border-studio-border">
                              {fkColumns.map((column) => (
                                <SelectItem
                                  key={column}
                                  value={column}
                                  className="text-xs"
                                >
                                  {column}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-foreground">
                            On Update
                          </Label>
                          <Select
                            value={fkOnUpdate}
                            onValueChange={setFkOnUpdate}
                          >
                            <SelectTrigger className="bg-muted/20 border-studio-border h-8 w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-studio-bg border-studio-border">
                              <FkActionSelectItems />
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs font-medium text-foreground">
                            On Delete
                          </Label>
                          <Select
                            value={fkOnDelete}
                            onValueChange={setFkOnDelete}
                          >
                            <SelectTrigger className="bg-muted/20 border-studio-border h-8 w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-studio-bg border-studio-border">
                              <FkActionSelectItems />
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              <section className="grid gap-3 px-4 py-4 lg:grid-cols-[120px_1fr]">
                <div>
                  <h3 className="text-sm font-semibold leading-none text-foreground">
                    Constraints
                  </h3>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2.5 rounded-lg border border-studio-border bg-muted/10 p-2.5">
                    <Switch
                      checked={isPrimary}
                      onCheckedChange={(checked) => {
                        setIsPrimary(!!checked);
                        if (checked) setIsNullable(false);
                      }}
                      disabled={disablePrimaryAndUnique}
                      className="mt-0.5 h-4 w-7 border border-studio-border data-[state=unchecked]:bg-muted/20"
                      thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                    />
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        Is Primary Key
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Use this column as the row identifier
                        {disablePrimaryAndUnique
                          ? " (SQLite ALTER TABLE limitation)"
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg border border-studio-border bg-muted/10 p-2.5">
                    <Switch
                      checked={isNullable}
                      onCheckedChange={(checked) => setIsNullable(!!checked)}
                      disabled={isPrimary}
                      className="mt-0.5 h-4 w-7 border border-studio-border data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-muted/20"
                      thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                    />
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        Allow Nullable
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Allow the column to contain NULL values.
                      </div>
                    </div>
                  </div>
                  {!isMongo && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-studio-border bg-muted/10 p-2.5">
                      <Switch
                        checked={isUnique}
                        onCheckedChange={(checked) => setIsUnique(!!checked)}
                        disabled={disablePrimaryAndUnique}
                        className="mt-0.5 h-4 w-7 border border-studio-border"
                        thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                      />
                      <div>
                        <div className="text-xs font-medium text-foreground">
                          Is Unique
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Enforce unique values for this column
                          {disablePrimaryAndUnique
                            ? " (SQLite ALTER TABLE limitation)"
                            : ""}
                        </div>
                      </div>
                    </div>
                  )}
                  {!isMongo && (
                    <div className="space-y-1.5 pt-1.5">
                      <Label
                        htmlFor="checkConstraint"
                        className="text-xs font-medium text-foreground"
                      >
                        Check Constraint (Optional)
                      </Label>
                      <Input
                        id="checkConstraint"
                        value={checkConstraint}
                        onChange={(e) => setCheckConstraint(e.target.value)}
                        placeholder={`length("${name || "column_name"}") < 500`}
                        className="bg-muted/20 border-studio-border text-foreground focus-visible:ring-primary/50 h-8 font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>

          <SheetFooter className="mt-auto p-4">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={createMore}
                  onCheckedChange={(checked) => setCreateMore(!!checked)}
                  className="h-4 w-7 border border-studio-border data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-muted/20"
                  thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                />
                <span className="text-xs text-muted-foreground">
                  Create more
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  className="h-8 px-2.5 hover:bg-muted text-xs"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAdd}
                  disabled={!canSubmit || isAdding}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 h-8 min-w-[100px] text-xs"
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      {isMongo ? "Add Field" : "Add Column"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
