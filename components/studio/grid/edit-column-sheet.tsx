"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Loader2, PencilLine } from "@/lib/icon-theme/lucide-react";
import { POSTGRES_EDIT_COLUMN_TYPES } from "@/lib/db/column-types";
import type { EditColumnPayload } from "./types";

interface EditColumnSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  connectionString: string;
  selectedSchema?: string | null;
  tableName: string;
  columnName: string | null;
  tableStructure: any[];
  foreignKeys?: Array<{
    column_name: string;
    foreign_table_schema: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }>;
  enums?: Array<{
    schema: string;
    name: string;
    values: string[];
  }>;
  onEditColumn: (payload: EditColumnPayload) => Promise<void>;
  isEditing: boolean;
}

export function EditColumnSheet({
  isOpen,
  onOpenChange,
  connectionString,
  selectedSchema,
  tableName,
  columnName,
  tableStructure,
  foreignKeys = [],
  enums = [],
  onEditColumn,
  isEditing,
}: EditColumnSheetProps) {
  const dbType = useMemo(
    () => detectConnectionDbType(connectionString),
    [connectionString],
  );
  const isMongo = dbType === "mongodb";
  const isPostgres = dbType === "postgres" || dbType === "supabase-mgmt";
  const [newName, setNewName] = useState("");
  const [dataType, setDataType] = useState(POSTGRES_EDIT_COLUMN_TYPES[0]);
  const [isNullable, setIsNullable] = useState(true);
  const [isPrimary, setIsPrimary] = useState(false);
  const [isUnique, setIsUnique] = useState(false);
  const [uniqueTouched, setUniqueTouched] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [checkConstraint, setCheckConstraint] = useState("");
  const [checkTouched, setCheckTouched] = useState(false);
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

  const currentColumn = useMemo(() => {
    if (!columnName) return null;
    return (
      tableStructure?.find(
        (col) => (col?.name || col?.column_name) === columnName,
      ) ?? null
    );
  }, [tableStructure, columnName]);

  const currentType = useMemo(() => {
    const rawType = String(
      currentColumn?.data_type ||
        currentColumn?.udt_name ||
        currentColumn?.type ||
        "",
    ).trim();
    return rawType || "unknown";
  }, [currentColumn]);

  const normalizeType = useMemo(() => {
    return (value: string) => {
      const normalized = value.trim();
      const match = POSTGRES_EDIT_COLUMN_TYPES.find(
        (type) => type.toUpperCase() === normalized.toUpperCase(),
      );
      return match || normalized;
    };
  }, []);

  const resolvedDataType = useMemo(() => {
    const base =
      (dataType && dataType.trim()) ||
      (currentType && currentType.trim()) ||
      POSTGRES_EDIT_COLUMN_TYPES[0];
    return normalizeType(base);
  }, [dataType, currentType, normalizeType]);

  const enumTypeOptions = useMemo(
    () =>
      enums
        .map((entry) => {
          const schema = String(entry?.schema || "").trim();
          const name = String(entry?.name || "").trim();
          if (!schema || !name) return null;
          return `${schema}.${name}`;
        })
        .filter((value): value is string => Boolean(value)),
    [enums],
  );

  const typeOptions = useMemo(() => {
    const normalized = resolvedDataType.toUpperCase();
    const baseOptions = [...POSTGRES_EDIT_COLUMN_TYPES, ...enumTypeOptions];
    if (baseOptions.some((type) => type.toUpperCase() === normalized))
      return baseOptions;
    return [resolvedDataType, ...baseOptions];
  }, [resolvedDataType, enumTypeOptions]);

  useEffect(() => {
    if (!isOpen) return;
    setNewName(columnName || "");
    const initialType = String(
      currentColumn?.data_type ||
        currentColumn?.udt_name ||
        currentColumn?.type ||
        "",
    ).trim();
    setDataType(normalizeType(initialType || POSTGRES_EDIT_COLUMN_TYPES[0]));
    const nullableRaw = currentColumn?.is_nullable;
    setIsNullable(String(nullableRaw ?? "").toUpperCase() !== "NO");
    setIsPrimary(Boolean(currentColumn?.is_primary_key));
    setIsUnique(false);
    setUniqueTouched(false);
    setDefaultValue(
      currentColumn?.column_default ? String(currentColumn.column_default) : "",
    );
    setCheckConstraint("");
    setCheckTouched(false);
    const existingFk = foreignKeys.find((fk) => fk.column_name === columnName);
    if (existingFk) {
      setAddForeignKey(true);
      setFkSchema(existingFk.foreign_table_schema || selectedSchema || "");
      setFkTable(existingFk.foreign_table_name || "");
      setFkColumn(existingFk.foreign_column_name || "");
    } else {
      setAddForeignKey(false);
      setFkSchema(selectedSchema || "");
      setFkTable("");
      setFkColumn("");
    }
  }, [isOpen, columnName, currentColumn, foreignKeys, selectedSchema]);

  useForeignKeyFetchEffects({
    isOpen,
    skip: !isPostgres,
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

  const canSubmit =
    Boolean(columnName && newName.trim()) &&
    (!addForeignKey || Boolean(fkSchema && fkTable && fkColumn));

  const handleSave = async () => {
    if (!columnName || !newName.trim()) return;
    await onEditColumn({
      columnName,
      newName: newName.trim(),
      dataType: dataType.trim(),
      isNullable,
      isPrimary,
      isUnique,
      uniqueTouched,
      defaultValue: defaultValue.trim(),
      checkConstraint: checkConstraint.trim(),
      checkTouched,
      foreignKeyEnabled: addForeignKey,
      foreignKey:
        addForeignKey && fkSchema && fkTable && fkColumn
          ? {
              schema: fkSchema,
              table: fkTable,
              column: fkColumn,
              onUpdate: fkOnUpdate,
              onDelete: fkOnDelete,
            }
          : undefined,
    });
    onOpenChange(false);
  };

  const displayTarget = selectedSchema
    ? `${selectedSchema}.${tableName}`
    : tableName;

  const isDirty = useMemo(() => {
    if (!columnName) return false;
    const initType = normalizeType(
      String(
        currentColumn?.data_type ||
          currentColumn?.udt_name ||
          currentColumn?.type ||
          "",
      ).trim(),
    );
    const initNullable =
      String(currentColumn?.is_nullable ?? "").toUpperCase() !== "NO";
    const initDefault = currentColumn?.column_default
      ? String(currentColumn.column_default)
      : "";
    const initFk = foreignKeys.some((fk) => fk.column_name === columnName);
    return (
      newName !== columnName ||
      dataType !== initType ||
      isNullable !== initNullable ||
      isPrimary !== Boolean(currentColumn?.is_primary_key) ||
      isUnique ||
      uniqueTouched ||
      defaultValue !== initDefault ||
      checkConstraint !== "" ||
      checkTouched ||
      addForeignKey !== initFk
    );
  }, [
    columnName,
    newName,
    dataType,
    isNullable,
    isPrimary,
    isUnique,
    uniqueTouched,
    defaultValue,
    checkConstraint,
    checkTouched,
    addForeignKey,
    currentColumn,
    foreignKeys,
    normalizeType,
  ]);

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
    <Sheet open={isOpen} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        contained
        onInteractOutside={handleInteractOutside}
        className="bg-studio-bg border-studio-border text-foreground w-[min(540px,88vw)] data-[side=right]:sm:max-w-[540px] flex flex-col h-full p-0"
      >
        {ConfirmDialog}
        <div className="flex flex-col h-full">
          <SheetHeader className="px-4 py-3 border-b border-studio-border/80">
            <SheetTitle className="text-sm font-semibold leading-none tracking-tight text-foreground flex items-center gap-1.5">
              <PencilLine className="w-3.5 h-3.5" />
              {isMongo ? "Edit field" : "Edit column"}
            </SheetTitle>
            <SheetDescription className="pt-0.5 text-xs text-muted-foreground">
              Rename {isMongo ? "field" : "column"} in{" "}
              <span className="text-foreground">{displayTarget}</span>. Data
              remains intact.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Column name
              </Label>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={columnName || "column_name"}
                className="h-8 text-xs bg-studio-bg border-studio-border"
              />
            </div>
            {!isMongo && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Data type
                </Label>
                <Select value={resolvedDataType} onValueChange={setDataType}>
                  <SelectTrigger className="h-8 w-full text-xs bg-studio-bg border-studio-border text-foreground">
                    <SelectValue
                      placeholder="Select data type"
                      className="text-foreground"
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-studio-bg border-studio-border">
                    {typeOptions.map((type) => (
                      <SelectItem key={type} value={type} className="text-xs">
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isMongo && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Default</Label>
                <Input
                  value={defaultValue}
                  onChange={(event) => setDefaultValue(event.target.value)}
                  className="h-8 text-xs bg-studio-bg border-studio-border font-mono"
                  placeholder="Leave empty to drop default"
                />
              </div>
            )}
            {!isMongo && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Constraints
                </Label>
                <div className="grid gap-2.5 rounded-lg border border-studio-border bg-studio-bg px-2.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Allow NULL values
                    </span>
                    <Switch
                      checked={isNullable}
                      onCheckedChange={setIsNullable}
                      className="h-4 w-7"
                      thumbClassName="size-3"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Primary key
                    </span>
                    <Switch
                      checked={isPrimary}
                      onCheckedChange={(checked) => {
                        setIsPrimary(checked);
                        if (checked) setIsNullable(false);
                      }}
                      className="h-4 w-7"
                      thumbClassName="size-3"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Unique
                    </span>
                    <Switch
                      checked={isUnique}
                      onCheckedChange={(checked) => {
                        setIsUnique(checked);
                        setUniqueTouched(true);
                      }}
                      className="h-4 w-7"
                      thumbClassName="size-3"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Check constraint
                    </Label>
                    <Input
                      value={checkConstraint}
                      onChange={(event) => {
                        setCheckConstraint(event.target.value);
                        setCheckTouched(true);
                      }}
                      className="h-8 text-xs bg-studio-bg border-studio-border font-mono"
                      placeholder="e.g. price > 0"
                    />
                  </div>
                </div>
              </div>
            )}
            {!isMongo && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Foreign key
                </Label>
                <div className="flex items-center justify-between rounded-lg border border-studio-border bg-studio-bg px-2.5 py-1.5">
                  <span className="text-xs text-muted-foreground">
                    Reference another table
                  </span>
                  <Switch
                    checked={addForeignKey}
                    onCheckedChange={onForeignKeyToggle}
                    className="h-4 w-7"
                    thumbClassName="size-3"
                  />
                </div>
              </div>
            )}
            {!isMongo && addForeignKey && (
              <div className="grid gap-2.5">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Referenced schema
                  </Label>
                  <Select value={fkSchema} onValueChange={setFkSchema}>
                    <SelectTrigger className="h-8 text-xs bg-studio-bg border-studio-border">
                      <SelectValue placeholder="Schema" />
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
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Referenced table
                  </Label>
                  <Select value={fkTable} onValueChange={setFkTable}>
                    <SelectTrigger className="h-8 text-xs bg-studio-bg border-studio-border">
                      <SelectValue placeholder="Table" />
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
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Referenced column
                  </Label>
                  <Select value={fkColumn} onValueChange={setFkColumn}>
                    <SelectTrigger className="h-8 text-xs bg-studio-bg border-studio-border">
                      <SelectValue placeholder="Column" />
                    </SelectTrigger>
                    <SelectContent className="bg-studio-bg border-studio-border">
                      {fkColumns.map((col) => (
                        <SelectItem key={col} value={col} className="text-xs">
                          {col}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      On update
                    </Label>
                    <Select value={fkOnUpdate} onValueChange={setFkOnUpdate}>
                      <SelectTrigger className="h-8 text-xs bg-studio-bg border-studio-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-studio-bg border-studio-border">
                        <FkActionSelectItems />
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      On delete
                    </Label>
                    <Select value={fkOnDelete} onValueChange={setFkOnDelete}>
                      <SelectTrigger className="h-8 text-xs bg-studio-bg border-studio-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-studio-bg border-studio-border">
                        <FkActionSelectItems />
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      On delete
                    </Label>
                    <Select value={fkOnDelete} onValueChange={setFkOnDelete}>
                      <SelectTrigger className="h-8 text-xs bg-studio-bg border-studio-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-studio-bg border-studio-border">
                        <FkActionSelectItems />
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
            {!isPostgres && (
              <div className="text-xs text-amber-400/90">
                Editing constraints is currently supported only for PostgreSQL.
              </div>
            )}
          </div>

          <SheetFooter className="mt-auto border-t border-studio-border/80 px-4 py-2">
            <div className="flex w-full items-center justify-end gap-1.5">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="h-8 text-xs hover:bg-studio-row-hover"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!canSubmit || isEditing}
                className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 px-4 text-xs"
              >
                {isEditing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
