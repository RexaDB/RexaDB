"use client";

import { useMemo, useState } from "react";
import { Shield, ChevronDown } from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { RlsPolicy, TableColumn } from "./rls-policies-list";
import { toRolesArray } from "@/lib/studio/rls-utils";
import { HighlightedTextarea } from "./highlighted-textarea";
import { RlsPolicyFormFields, buildRlsPolicyPayload } from "./rls-policy-form-fields";
import { TableDefinitionView } from "./table-definition-view";

interface RlsPolicyEditorViewProps {
  policy?: RlsPolicy;
  prefillSchema?: string;
  prefillTable?: string;
  tables: Array<{ schema: string; table_name: string }>;
  availableRoles: string[];
  schemaData?: Record<
    string,
    { schema: string; name: string; columns: TableColumn[] }
  >;
  onSavePolicy?: (
    original: RlsPolicy,
    updates: {
      name: string;
      command: string;
      permissive: "PERMISSIVE" | "RESTRICTIVE";
      roles: string[];
      usingExpression: string | null;
      withCheckExpression: string | null;
    },
  ) => Promise<void>;
  onCreatePolicy?: (values: {
    schema: string;
    tableName: string;
    name: string;
    command: string;
    permissive: "PERMISSIVE" | "RESTRICTIVE";
    roles: string[];
    usingExpression: string | null;
    withCheckExpression: string | null;
  }) => Promise<void>;
  onClose: () => void;
}

export function RlsPolicyEditorView({
  policy,
  prefillSchema,
  prefillTable,
  tables,
  availableRoles,
  schemaData,
  onSavePolicy,
  onCreatePolicy,
  onClose,
}: RlsPolicyEditorViewProps) {
  const isEdit = !!policy;

  const [formName, setFormName] = useState(policy?.name ?? "");
  const [formCommand, setFormCommand] = useState(
    (policy?.command || "all").toLowerCase(),
  );
  const [formPermissive, setFormPermissive] = useState<
    "PERMISSIVE" | "RESTRICTIVE"
  >(
    String(policy?.permissive || "PERMISSIVE").toUpperCase() === "RESTRICTIVE"
      ? "RESTRICTIVE"
      : "PERMISSIVE",
  );
  const [formRoles, setFormRoles] = useState(
    toRolesArray(policy?.roles ?? []).join(", "),
  );
  const [formUsingExpression, setFormUsingExpression] = useState(
    policy?.using_expression ?? "",
  );
  const [formWithCheckExpression, setFormWithCheckExpression] = useState(
    policy?.with_check_expression ?? "",
  );
  const [formTableName, setFormTableName] = useState(
    isEdit ? "" : (prefillTable ?? ""),
  );
  const [tableDefView, setTableDefView] = useState<"columns" | "sql">(
    "columns",
  );
  const [isSaving, setIsSaving] = useState(false);

  const schema = policy?.schema ?? prefillSchema ?? "";
  const tableName =
    policy?.table_name ?? (isEdit ? "" : formTableName) ?? prefillTable ?? "";

  const tableKey = schema && tableName ? `${schema}.${tableName}` : "";
  const entry = tableKey ? schemaData?.[tableKey] : undefined;
  const columns = entry?.columns ?? [];

  const createTableSql = useMemo(() => {
    if (!columns.length) return "";
    const parts = columns.map((col) => {
      const p = [`  ${col.name} ${col.type}`];
      if (col.isPrimary) p.push("PRIMARY KEY");
      if (!col.isNullable) p.push("NOT NULL");
      return p.join(" ");
    });
    return `CREATE TABLE ${tableKey} (\n${parts.join(",\n")}\n);`;
  }, [columns, tableKey]);

  const handleSave = async () => {
    if (!formName.trim()) return;
    if (!isEdit && !tableName) return;
    setIsSaving(true);
    try {
      const payload = buildRlsPolicyPayload({
        formName, formCommand, formPermissive, formRoles, formUsingExpression, formWithCheckExpression,
      } as any);
      if (isEdit && onSavePolicy && policy) {
        await onSavePolicy(policy, payload);
      } else if (onCreatePolicy) {
        await onCreatePolicy({
          schema: schema,

          tableName: tableName,
          ...payload,
        });
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden min-h-0">
      <div className="p-6 pb-0 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Shield className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground tracking-tight">
              {isEdit ? `Edit Policy: ${policy.name}` : "New RLS Policy"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? `Update ${policy.schema}.${policy.table_name}`
                : `Create a policy for ${prefillSchema}.${tableName || "..."}`}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-6 gap-4 overflow-hidden">
        <div className="space-y-4 min-h-0 overflow-y-auto">
          <div
            className={cn("grid gap-3", isEdit ? "grid-cols-2" : "grid-cols-2")}
          >
            {isEdit ? (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Schema
                  </label>
                  <Input value={schema} disabled className="h-9 text-xs" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Table
                  </label>
                  <Input value={tableName} disabled className="h-9 text-xs" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Schema
                  </label>
                  <Input value={schema} disabled className="h-9 text-xs" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Table
                  </label>
                  <SelectWithSearch
                    options={tables
                      .filter((t) => t.schema === prefillSchema)
                      .map((t) => ({
                        value: t.table_name,
                        label: t.table_name,
                      }))}
                    value={formTableName}
                    onValueChange={setFormTableName}
                    placeholder="Select a table..."
                    searchPlaceholder="Search table..."
                    emptyText="No tables found."
                    searchThreshold={10}
                    triggerClassName="h-9 text-xs bg-muted/30 border-border"
                  />
                </div>
              </>
            )}
          </div>

          <RlsPolicyFormFields
            formName={formName}
            setFormName={setFormName}
            formCommand={formCommand}
            setFormCommand={setFormCommand}
            formPermissive={formPermissive}
            setFormPermissive={setFormPermissive}
            formRoles={formRoles}
            setFormRoles={setFormRoles}
            formUsingExpression={formUsingExpression}
            setFormUsingExpression={setFormUsingExpression}
            formWithCheckExpression={formWithCheckExpression}
            setFormWithCheckExpression={setFormWithCheckExpression}
          />
        </div>

        {columns.length > 0 && (
          <TableDefinitionView
            tableKey={tableKey}
            columns={columns}
            viewMode={tableDefView}
            onViewModeChange={setTableDefView}
            sqlContent={createTableSql}
          />
        )}
      </div>

      <div className="p-6 border-t border-border bg-muted/5 shrink-0 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || !formName.trim() || (!isEdit && !tableName)}
        >
          {isSaving ? "Saving..." : isEdit ? "Save policy" : "Create policy"}
        </Button>
      </div>
    </div>
  );
}
