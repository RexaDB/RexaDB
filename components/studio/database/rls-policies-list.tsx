"use client";

import { useMemo, useState, useCallback } from "react";
import {
  Shield,
  Search,
  ChevronDown,
  MoreVertical,
  Pencil,
  Trash2,
  RefreshCw,
  Plus,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddRlsPolicySheet } from "./add-rls-policy-sheet";
import { useSheetCloseConfirm } from "@/hooks/use-sheet-close-confirm";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { toRolesArray } from "@/lib/studio/rls-utils";
import { HighlightedTextarea } from "./highlighted-textarea";
import { RlsPolicyFormFields, buildRlsPolicyPayload } from "./rls-policy-form-fields";
import { TableDefinitionView } from "./table-definition-view";
import { DbListHeader } from "./db-list-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

export interface RlsPolicy {
  schema: string;
  table_name: string;
  name: string;
  permissive: string;
  roles: string[] | string | null;
  command: string;
  using_expression: string | null;
  with_check_expression: string | null;
  rls_enabled: boolean;
  rls_forced: boolean;
}

export interface TableColumn {
  name: string;
  type: string;
  isPrimary?: boolean;
  isNullable?: boolean;
  references?: { schema: string; table: string; column: string } | null;
}

interface RlsPoliciesListProps {
  policies: RlsPolicy[];
  availableRoles: string[];
  selectedSchema: string;
  schemas: string[];
  tables: { schema: string; table_name: string }[];
  onSchemaChange: (schema: string) => void;
  onRefresh: () => void;
  onSavePolicy: (
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
  onDeletePolicy: (policy: RlsPolicy) => Promise<void>;
  onAddPolicy: (values: {
    schema: string;
    tableName: string;
    name: string;
    command: string;
    permissive: "PERMISSIVE" | "RESTRICTIVE";
    roles: string[];
    usingExpression: string | null;
    withCheckExpression: string | null;
  }) => Promise<void>;
  tableFilter: string;
  setTableFilter: (value: string) => void;
  policyFilter: string;
  setPolicyFilter: (value: string) => void;
  fetchingPolicies?: boolean;
  schemaData?: Record<
    string,
    { schema: string; name: string; columns: TableColumn[] }
  >;
  rlsPolicyTabEditor?: boolean;
  onOpenEditTab?: (policy: RlsPolicy) => void;
  onOpenCreateTab?: (schema: string, tableName?: string) => void;
}

function getPolicyKey(policy: RlsPolicy) {
  return `${policy.schema}.${policy.table_name}.${policy.name}.${policy.command}`;
}

export function RlsPoliciesList({
  policies,
  availableRoles,
  selectedSchema,
  schemas,
  tables,
  onSchemaChange,
  onRefresh,
  onSavePolicy,
  onDeletePolicy,
  onAddPolicy,
  tableFilter,
  setTableFilter,
  policyFilter,
  setPolicyFilter,
  fetchingPolicies,
  schemaData,
  rlsPolicyTabEditor,
  onOpenEditTab,
  onOpenCreateTab,
}: RlsPoliciesListProps) {
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [initialTableForNewPolicy, setInitialTableForNewPolicy] = useState("");
  const [editingPolicy, setEditingPolicy] = useState<RlsPolicy | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("all");
  const [formPermissive, setFormPermissive] = useState<
    "PERMISSIVE" | "RESTRICTIVE"
  >("PERMISSIVE");
  const [formRoles, setFormRoles] = useState("");
  const [formUsingExpression, setFormUsingExpression] = useState("");
  const [formWithCheckExpression, setFormWithCheckExpression] = useState("");
  const [tableDefView, setTableDefView] = useState<"columns" | "sql">(
    "columns",
  );
  const { appShellLayout, confirmSheetClose } = useGlobalStudioSettings();

  const editIsDirty = useMemo(() => {
    if (!editingPolicy) return false;
    const roles = toRolesArray(editingPolicy.roles).join(", ");
    return (
      formName !== editingPolicy.name ||
      formCommand !== (editingPolicy.command || "all").toLowerCase() ||
      formPermissive !==
        (String(editingPolicy.permissive).toUpperCase() === "RESTRICTIVE"
          ? "RESTRICTIVE"
          : "PERMISSIVE") ||
      formRoles !== roles ||
      formUsingExpression !== (editingPolicy.using_expression || "") ||
      formWithCheckExpression !== (editingPolicy.with_check_expression || "")
    );
  }, [
    editingPolicy,
    formName,
    formCommand,
    formPermissive,
    formRoles,
    formUsingExpression,
    formWithCheckExpression,
  ]);

  const closeEditSheet = useCallback(() => setEditingPolicy(null), []);
  const {
    handleInteractOutside: editHandleInteractOutside,
    ConfirmDialog: editConfirmDialog,
  } = useSheetCloseConfirm(editIsDirty, confirmSheetClose, closeEditSheet);

  const filteredPolicies = useMemo(() => {
    const tableSearch = tableFilter.toLowerCase();
    const policySearch = policyFilter.toLowerCase();

    return policies.filter((policy) => {
      const tableMatch = policy.table_name.toLowerCase().includes(tableSearch);
      const policyMatch = policy.name.toLowerCase().includes(policySearch);
      return tableMatch && policyMatch;
    });
  }, [policies, tableFilter, policyFilter]);

  const policiesByTable = useMemo(() => {
    const grouped = new Map<string, RlsPolicy[]>();

    for (const policy of filteredPolicies) {
      const existing = grouped.get(policy.table_name) || [];
      existing.push(policy);
      grouped.set(policy.table_name, existing);
    }

    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredPolicies]);

  const handleStartEdit = (policy: RlsPolicy) => {
    if (rlsPolicyTabEditor && onOpenEditTab) {
      onOpenEditTab(policy);
      return;
    }
    setEditingPolicy(policy);
    setFormName(policy.name);
    setFormCommand((policy.command || "all").toLowerCase());
    setFormPermissive(
      String(policy.permissive).toUpperCase() === "RESTRICTIVE"
        ? "RESTRICTIVE"
        : "PERMISSIVE",
    );
    setFormRoles(toRolesArray(policy.roles).join(", "));
    setFormUsingExpression(policy.using_expression || "");
    setFormWithCheckExpression(policy.with_check_expression || "");
  };

  const handleSave = async () => {
    if (!editingPolicy) return;

    setIsSaving(true);
    try {
      await onSavePolicy(editingPolicy, buildRlsPolicyPayload({
        formName, formCommand, formPermissive, formRoles, formUsingExpression, formWithCheckExpression,
      } as any));
      setEditingPolicy(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (policy: RlsPolicy) => {
    setIsDeleting(true);
    try {
      await onDeletePolicy(policy);
      if (
        editingPolicy &&
        getPolicyKey(editingPolicy) === getPolicyKey(policy)
      ) {
        setEditingPolicy(null);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete policy",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden min-h-0">
      <div className="p-8 pb-4">
        <h1 className="text-sm font-semibold text-foreground tracking-tight">
          RLS Policies
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and manage Row Level Security policies in the{" "}
          <code className="bg-muted px-1 rounded">{selectedSchema}</code> schema
        </p>
      </div>

      <div className="px-8 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="bg-background border-border h-9 text-xs flex items-center gap-2 px-3 hover:bg-muted/40 transition-all text-muted-foreground"
              >
                <span className="font-normal opacity-50">schema</span>
                <span className="text-foreground font-medium tracking-tight">
                  {selectedSchema}
                </span>
                <ChevronDown className="w-3.5 h-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-48 bg-popover border-border text-foreground shadow-2xl"
            >
              {schemas.map((schema) => (
                <DropdownMenuItem
                  key={schema}
                  onClick={() => onSchemaChange(schema)}
                  className={`text-xs ${selectedSchema === schema ? "bg-primary/10 text-primary" : ""}`}
                >
                  {schema}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="relative flex-1 max-w-xs group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Filter by table"
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              className="pl-9 h-9 bg-background border-border focus-visible:ring-primary/50 text-xs placeholder:text-muted-foreground/30 shadow-sm"
            />
          </div>

          <div className="relative flex-1 max-w-xs group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Filter by policy"
              value={policyFilter}
              onChange={(e) => setPolicyFilter(e.target.value)}
              className="pl-9 h-9 bg-background border-border focus-visible:ring-primary/50 text-xs placeholder:text-muted-foreground/30 shadow-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onRefresh}
            className="h-9 text-xs"
            disabled={fetchingPolicies}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1 ${fetchingPolicies ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            onClick={() => {
              if (rlsPolicyTabEditor && onOpenCreateTab) {
                onOpenCreateTab(selectedSchema);
              } else {
                setInitialTableForNewPolicy("");
                setIsAddSheetOpen(true);
              }
            }}
            className="h-9 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Policy
          </Button>
        </div>
      </div>

      <div className="px-8 flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">
          {fetchingPolicies && policies.length === 0 && (
            <div className="py-20 text-center text-sm text-muted-foreground">
              Loading RLS policies...
            </div>
          )}

          {!fetchingPolicies &&
            policiesByTable.map(([tableName, tablePolicies]) => (
              <div
                key={tableName}
                className="border border-border rounded-lg overflow-hidden bg-card/40 shadow-sm"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <Shield className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                    <span className="text-xs font-semibold text-foreground truncate">
                      {tableName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="text-xs tracking-wider"
                    >
                      {tablePolicies.length}{" "}
                      {tablePolicies.length === 1 ? "policy" : "policies"}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        const tableSchema =
                          tablePolicies[0]?.schema || selectedSchema;
                        if (rlsPolicyTabEditor && onOpenCreateTab) {
                          onOpenCreateTab(tableSchema, tableName);
                        } else {
                          setInitialTableForNewPolicy(
                            `${tableSchema}.${tableName}`,
                          );
                          setIsAddSheetOpen(true);
                        }
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      New Policy
                    </Button>
                  </div>
                </div>

                <DbListHeader
                  columns={["Schema", "Policy", "Command", "Mode", "RLS"]}
                  gridTemplateColumns="120px 1fr 120px 140px 120px 48px"
                />

                <div className="divide-y divide-border/60">
                  {tablePolicies.map((policy) => (
                    <div
                      key={getPolicyKey(policy)}
                      className="grid grid-cols-[120px_1fr_120px_140px_120px_48px] items-center py-4 px-4 hover:bg-muted/20 transition-colors"
                    >
                      <span className="text-xs font-medium text-muted-foreground/70">
                        {policy.schema}
                      </span>
                      <span className="text-xs font-medium text-foreground truncate">
                        {policy.name}
                      </span>
                      <span className="text-xs tracking-wider text-primary/80">
                        {policy.command}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-xs w-fittracking-wider"
                      >
                        {String(policy.permissive).toUpperCase()}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <Badge
                          variant={policy.rls_enabled ? "default" : "outline"}
                          className="text-xs"
                        >
                          {policy.rls_enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        {policy.rls_forced && (
                          <Badge variant="outline" className="text-xs">
                            Forced
                          </Badge>
                        )}
                      </div>
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-8 w-8 p-0 hover:bg-muted/40"
                            >
                              <MoreVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-44 bg-popover border-border text-foreground shadow-2xl"
                          >
                            <DropdownMenuItem
                              onClick={() => handleStartEdit(policy)}
                              className="text-xs flex items-center gap-2"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit policy
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(policy)}
                              className="text-xs flex items-center gap-2 text-red-500 focus:text-red-500 focus:bg-red-500/10"
                              disabled={isDeleting}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete policy
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          {!fetchingPolicies && filteredPolicies.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Shield className="w-10 h-10 text-muted-foreground/10 mb-4" />
              <h3 className="text-sm font-medium text-foreground">
                No RLS policies found
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                Try a different table/policy filter or choose another schema.
              </p>
            </div>
          )}
        </div>
        <div className="h-8" />
      </div>

      <AddRlsPolicySheet
        open={isAddSheetOpen}
        onOpenChange={setIsAddSheetOpen}
        tables={tables}
        selectedSchema={selectedSchema}
        availableRoles={availableRoles}
        initialTable={initialTableForNewPolicy}
        onSave={async (values) => {
          await onAddPolicy(values);
        }}
      />

      <Sheet
        open={!!editingPolicy}
        onOpenChange={(open) => !open && setEditingPolicy(null)}
      >
        <SheetContent
          side="right"
          contained={appShellLayout}
          onInteractOutside={editHandleInteractOutside}
          style={{ maxWidth: "min(1020px, 100vw)" }}
          className="bg-background border-border text-foreground flex flex-col p-0 gap-0"
        >
          {editConfirmDialog}
          <SheetHeader className="p-6 border-b shrink-0">
            <SheetTitle className="text-sm font-semibold">
              Edit RLS Policy
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Update command, permissive mode, roles, and expressions for this
              policy.
            </SheetDescription>
          </SheetHeader>

          {editingPolicy && (
            <div className="flex-1 flex flex-col min-h-0 p-6 gap-4 overflow-hidden">
              <div className="space-y-4 min-h-0 overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Schema
                    </label>
                    <Input
                      value={editingPolicy.schema}
                      disabled
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Table
                    </label>
                    <Input
                      value={editingPolicy.table_name}
                      disabled
                      className="h-9 text-xs"
                    />
                  </div>
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

              {(() => {
                const tableKey = `${editingPolicy.schema}.${editingPolicy.table_name}`;
                const entry = schemaData?.[tableKey];
                const columns = entry?.columns;
                if (!columns || columns.length === 0) return null;

                const createTableSql = columns
                  .map((col) => {
                    const parts = [`  ${col.name} ${col.type}`];
                    if (col.isPrimary) parts.push("PRIMARY KEY");
                    if (!col.isNullable) parts.push("NOT NULL");
                    return parts.join(" ");
                  })
                  .join(",\n");
                const fullSql = `CREATE TABLE ${tableKey} (\n${createTableSql}\n);`;

                return (
                  <TableDefinitionView
                    tableKey={tableKey}
                    columns={columns}
                    viewMode={tableDefView}
                    onViewModeChange={setTableDefView}
                    sqlContent={fullSql}
                  />
                );
              })()}
            </div>
          )}

          <SheetFooter className="p-6 border-t border-border bg-muted/5 mt-auto flex-row justify-end gap-3 shrink-0">
            <Button
              variant="secondary"
              onClick={() => setEditingPolicy(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !formName.trim()}
            >
              {isSaving ? "Saving..." : "Save policy"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
