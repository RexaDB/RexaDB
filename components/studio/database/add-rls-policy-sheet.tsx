"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { useSheetCloseConfirm } from "@/hooks/use-sheet-close-confirm";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { Search, Shield, Terminal, Lock, ArrowLeft } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { highlightSql } from "@/lib/ai/sql-highlight";
import { handleTextareaTabKey } from "@/lib/studio/textarea-utils";

/* ─────────────────────────── Types ─────────────────────────── */

type Command = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
type Permissive = "PERMISSIVE" | "RESTRICTIVE";

interface TableInfo {
  schema: string;
  table_name: string;
}

interface PolicyValues {
  name: string;
  table: string; // "schema.table_name"
  permissive: Permissive;
  command: Command;
  roles: string;
  usingExpression: string;
  withCheckExpression: string;
}

interface Template {
  id: string;
  command: Command;
  title: string;
  description: string;
  using: string;
  withCheck: string;
}

export interface AddRlsPolicySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: TableInfo[];
  selectedSchema: string;
  availableRoles: string[];
  initialTable?: string;
  onSave: (values: {
    schema: string;
    tableName: string;
    name: string;
    command: string;
    permissive: Permissive;
    roles: string[];
    usingExpression: string | null;
    withCheckExpression: string | null;
  }) => Promise<void>;
}

/* ─────────────────────────── Templates ─────────────────────────── */

const TEMPLATES: Template[] = [
  {
    id: "read-all",
    command: "SELECT",
    title: "Enable read access for all users",
    description:
      "This policy gives read access to your table for all users via the SELECT operation.",
    using: "true",
    withCheck: "",
  },
  {
    id: "insert-auth",
    command: "INSERT",
    title: "Enable insert for authenticated users only",
    description:
      "This policy gives insert access to your table for all authenticated users only.",
    using: "",
    withCheck: "auth.role() = 'authenticated'",
  },
  {
    id: "delete-user-id",
    command: "DELETE",
    title: "Enable delete for users based on user_id",
    description:
      'This policy assumes that your table has a column "user_id", and allows users to delete rows which the "user_id" column matches their ID.',
    using: "auth.uid() = user_id",
    withCheck: "",
  },
  {
    id: "insert-user-id",
    command: "INSERT",
    title: "Enable insert for users based on user_id",
    description:
      'This policy assumes that your table has a column "user_id", and allows users to insert rows which the "user_id" column matches their ID.',
    using: "",
    withCheck: "auth.uid() = user_id",
  },
  {
    id: "update-user-id",
    command: "UPDATE",
    title: "Enable update for users based on user_id",
    description:
      'This policy assumes that your table has a column "user_id", and allows users to update rows which the "user_id" column matches their ID.',
    using: "auth.uid() = user_id",
    withCheck: "auth.uid() = user_id",
  },
  {
    id: "all-user-id",
    command: "ALL",
    title: "Grant all operations for users based on user_id",
    description:
      'Allows full access to rows where "user_id" matches the authenticated user. Combines USING and WITH CHECK.',
    using: "auth.uid() = user_id",
    withCheck: "auth.uid() = user_id",
  },
];

/* ─────────────────────────── Helpers ─────────────────────────── */

const COMMAND_STYLES: Record<Command, string> = {
  SELECT:
    "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
  INSERT:
    "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  UPDATE: "bg-primary/15 text-primary border-primary/20",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  ALL: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
};

const COMMANDS: Command[] = ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"];

function supportsWithCheck(command: string) {
  const v = command.toLowerCase();
  return v === "all" || v === "insert" || v === "update";
}

function quoteRoles(roles: string[]) {
  if (!roles.length) return "PUBLIC";
  return roles
    .map((r) => {
      if (r.toLowerCase() === "public") return "PUBLIC";
      return `"${r.replace(/"/g, '""')}"`;
    })
    .join(", ");
}

function buildSql(values: PolicyValues, schema: string, tableName: string) {
  if (!values.name || !tableName) return "";
  const cmd = values.command.toUpperCase();
  const roles = values.roles
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const rolesStr = quoteRoles(roles);
  const usingClause = values.usingExpression
    ? ` USING (${values.usingExpression})`
    : "";
  const withCheckClause =
    supportsWithCheck(values.command) && values.withCheckExpression
      ? ` WITH CHECK (${values.withCheckExpression})`
      : "";
  return `CREATE POLICY "${values.name}"\n  ON "${schema}"."${tableName}"\n  AS ${values.permissive}\n  FOR ${cmd}\n  TO ${rolesStr}${usingClause}${withCheckClause};`;
}

/* ─────────────────────── Highlighted Textarea ─────────────────────── */

function SqlHighlightedTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    handleTextareaTabKey(e, value);
  };

  return (
    <div className="relative group">
      <pre className="absolute inset-0 p-0 m-0 font-mono text-xs leading-6 whitespace-pre-wrap pointer-events-none overflow-hidden text-foreground/80">
        <code>{value ? highlightSql(value) : null}</code>
      </pre>
      <textarea
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="relative w-full bg-transparent border-none focus:ring-0 p-0 m-0 resize-none h-6 text-transparent caret-foreground placeholder:text-muted-foreground/30 outline-none overflow-hidden font-mono text-xs leading-6"
        rows={1}
        style={{ minHeight: "1.5rem" }}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = "auto";
          target.style.height = target.scrollHeight + "px";
        }}
      />
      <div className="absolute -left-4 top-0 bottom-0 w-[2px] bg-primary/40 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
    </div>
  );
}

/* ─────────────────────────── Component ─────────────────────────── */

const DEFAULTS: PolicyValues = {
  name: "",
  table: "",
  permissive: "PERMISSIVE",
  command: "SELECT",
  roles: "",
  usingExpression: "",
  withCheckExpression: "",
};

export function AddRlsPolicySheet({
  open,
  onOpenChange,
  tables,
  selectedSchema,
  availableRoles,
  initialTable,
  onSave,
}: AddRlsPolicySheetProps) {
  const { appShellLayout, confirmSheetClose, modernUiLayout } = useGlobalStudioSettings();
  const shellLayout = appShellLayout || modernUiLayout;
  const [form, setForm] = useState<PolicyValues>({ ...DEFAULTS });
  const [templateSearch, setTemplateSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useState<"editor" | "templates">("editor");

  // Reset form when sheet opens
  useEffect(() => {
    if (open) {
      setForm({ ...DEFAULTS, table: initialTable || "" });
      setTemplateSearch("");
      setView("editor");
    }
  }, [open, initialTable]);

  const schemaFromTable = form.table.includes(".")
    ? form.table.split(".")[0]
    : selectedSchema;
  const tableNameFromTable = form.table.includes(".")
    ? form.table.split(".").slice(1).join(".")
    : form.table;

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.toLowerCase();
    if (!q) return TEMPLATES;
    return TEMPLATES.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.command.toLowerCase().includes(q),
    );
  }, [templateSearch]);

  const applyTemplate = (tpl: Template) => {
    setForm((prev) => ({
      ...prev,
      command: tpl.command,
      usingExpression: tpl.using,
      withCheckExpression: tpl.withCheck,
    }));
    setView("editor");
  };

  const isDirty = useMemo(
    () =>
      form.name !== DEFAULTS.name ||
      form.table !== DEFAULTS.table ||
      form.permissive !== DEFAULTS.permissive ||
      form.command !== DEFAULTS.command ||
      form.roles !== DEFAULTS.roles ||
      form.usingExpression !== DEFAULTS.usingExpression ||
      form.withCheckExpression !== DEFAULTS.withCheckExpression,
    [form],
  );

  const { handleInteractOutside, ConfirmDialog } = useSheetCloseConfirm(
    isDirty,
    confirmSheetClose,
    () => onOpenChange(false),
  );

  const handleSave = async () => {
    if (!form.name.trim() || !form.table) return;
    const roles = form.roles
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    setIsSaving(true);
    try {
      await onSave({
        schema: schemaFromTable,
        tableName: tableNameFromTable,
        name: form.name.trim(),
        command: form.command.toLowerCase(),
        permissive: form.permissive,
        roles,
        usingExpression: form.usingExpression.trim() || null,
        withCheckExpression: form.withCheckExpression.trim() || null,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const setField = <K extends keyof PolicyValues>(
    key: K,
    value: PolicyValues[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={!shellLayout}>
      <SheetContent
        side="right"
        contained={shellLayout}
        onInteractOutside={handleInteractOutside}
        showCloseButton={false}
        className={cn(
          "bg-background border-border text-foreground p-0 gap-0 flex flex-col",
          shellLayout ? "data-[side=right]:sm:max-w-[1020px]" : "data-[side=right]:sm:max-w-[1020px] w-full",
        )}
      >
        {ConfirmDialog}
        {/* Header */}
        <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                <Shield className="w-4 h-4 text-primary" />
              </div>
              <SheetTitle className="text-sm font-semibold truncate">
                {view === "templates"
                  ? "Choose a template"
                  : "Create a new Row Level Security policy"}
              </SheetTitle>
            </div>
            {view === "templates" ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1.5 shrink-0"
                onClick={() => setView("editor")}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 shrink-0"
                onClick={() => setView("templates")}
              >
                <Search className="w-3.5 h-3.5" />
                Templates
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {view === "editor" && (
          <div className="flex flex-col flex-1 overflow-y-auto min-w-0">
            <div className="flex-1 p-6 space-y-5">
              {/* Policy Name + Table */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foregroundtracking-wider">
                    Policy Name
                  </label>
                  <Input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder="Provide a name for your policy"
                    className="h-9 text-xs bg-muted/30 border-border focus-visible:ring-primary/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foregroundtracking-wider">
                    Table{" "}
                    <span className="text-muted-foreground/50 normal-case font-normal tracking-normal">
                      on clause
                    </span>
                  </label>
                  <SelectWithSearch
                    options={tables.map((t) => ({
                      value: `${t.schema}.${t.table_name}`,
                      label: `${t.schema}.${t.table_name}`,
                    }))}
                    value={form.table}
                    onValueChange={(v) => setField("table", v)}
                    placeholder="Select a table..."
                    searchPlaceholder="Search table..."
                    emptyText="No tables found."
                    searchThreshold={10}
                    triggerClassName="h-9 text-xs bg-muted/30 border-border"
                  />
                </div>
              </div>

              {/* Policy Behavior */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foregroundtracking-wider">
                  Policy Behavior{" "}
                  <span className="text-muted-foreground/50 normal-case font-normal tracking-normal">
                    as clause
                  </span>
                </label>
                <div className="w-48">
                  <SelectWithSearch
                    options={[
                      { value: "PERMISSIVE", label: "Permissive" },
                      { value: "RESTRICTIVE", label: "Restrictive" },
                    ]}
                    value={form.permissive}
                    onValueChange={(v) =>
                      setField("permissive", v as Permissive)
                    }
                    placeholder="Select behavior..."
                    searchThreshold={99}
                    triggerClassName="h-9 text-xs bg-muted/30 border-border"
                  />
                </div>
                <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-sm">
                  Permissive policies allow access when any one policy grants
                  it; restrictive policies require all applicable policies to
                  pass.
                </p>
              </div>

              {/* Policy Command */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foregroundtracking-wider">
                  Policy Command{" "}
                  <span className="text-muted-foreground/50 normal-case font-normal tracking-normal">
                    for clause
                  </span>
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {COMMANDS.map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => setField("command", cmd)}
                      className={cn(
                        "h-8 px-3 rounded-lg text-xs font-medium border transition-all flex items-center gap-2",
                        form.command === cmd
                          ? "bg-muted/50 border-foreground/30 text-foreground ring-1 ring-foreground/20"
                          : "bg-transparent border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <div
                        className={cn(
                          "w-2.5 h-2.5 rounded-lg border flex items-center justify-center",
                          form.command === cmd
                            ? "border-foreground"
                            : "border-muted-foreground/50",
                        )}
                      >
                        {form.command === cmd && (
                          <div className="w-1.2 h-1.2 rounded-lg bg-foreground" />
                        )}
                      </div>
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Roles */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foregroundtracking-wider">
                  Target Roles{" "}
                  <span className="text-muted-foreground/50 normal-case font-normal tracking-normal">
                    to clause
                  </span>
                </label>
                <SelectWithSearch
                  options={(availableRoles.length === 0
                    ? ["public"]
                    : availableRoles
                  ).map((role) => ({
                    value: role,
                    label: role,
                  }))}
                  value={form.roles}
                  onValueChange={(v) => setField("roles", v)}
                  placeholder="Defaults to all (public) roles if none selected"
                  searchPlaceholder="Search role..."
                  emptyText="No roles found."
                  searchThreshold={10}
                  triggerClassName="h-9 text-xs bg-muted/30 border-border"
                />
              </div>

              {/* SQL Editor Area */}
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center gap-1.5 px-1">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground/40" />
                  <span className="text-xs font-semibold text-muted-foreground/40tracking-widest">
                    USE OPTIONS ABOVE TO EDIT
                  </span>
                </div>

                <div className="rounded-lg bg-card/60 border border-border overflow-hidden font-mono text-xs leading-6 flex flex-col min-h-[280px]">
                  {/* Line Numbers + Content Wrapper */}
                  <div className="flex flex-1">
                    {/* Line Numbers */}
                    <div className="w-10 bg-muted/5 border-r border-border/50 flex flex-col items-center py-4 select-none text-muted-foreground/30 text-xs">
                      {Array.from({
                        length: supportsWithCheck(form.command) ? 11 : 8,
                      }).map((_, i) => (
                        <div key={i} className="h-6 flex items-center">
                          {i + 1}
                        </div>
                      ))}
                    </div>

                    {/* SQL Content */}
                    <div className="flex-1 py-4 px-4 overflow-x-auto">
                      <div className="flex items-center gap-2">
                        <span className="text-primary">create</span>
                        <span className="text-foreground">policy</span>
                        <span className="text-emerald-500 dark:text-emerald-400">
                          "{form.name || "policy_name"}"
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-primary">on</span>
                        <span className="text-emerald-500 dark:text-emerald-400">
                          "{schemaFromTable}"."
                          {tableNameFromTable || "table_name"}"
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-primary">as</span>
                        <span className="text-foreground">
                          {form.permissive}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-primary">for</span>
                        <span className="text-foreground">{form.command}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-primary">to</span>
                        <span className="text-foreground">
                          {form.roles || "public"}
                        </span>
                      </div>

                      {/* USING section */}
                      <div className="flex items-center gap-2">
                        <span className="text-primary">using</span>
                        <span className="text-foreground">(</span>
                      </div>
                      <SqlHighlightedTextarea
                        value={form.usingExpression}
                        onChange={(e) =>
                          setField("usingExpression", e.target.value)
                        }
                        placeholder="-- Provide a SQL expression for the using statement"
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">
                          {supportsWithCheck(form.command) ? ")" : ");"}
                        </span>
                      </div>

                      {/* WITH CHECK section */}
                      {supportsWithCheck(form.command) && (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-primary">with check</span>
                            <span className="text-foreground">(</span>
                          </div>
                          <SqlHighlightedTextarea
                            value={form.withCheckExpression}
                            onChange={(e) =>
                              setField("withCheckExpression", e.target.value)
                            }
                            placeholder="-- Provide a SQL expression for the with check statement"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-foreground">);</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border bg-muted/5 shrink-0 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !form.name.trim() || !form.table}
                className="text-xs bg-primary hover:bg-primary/90"
              >
                {isSaving ? "Saving…" : "Save policy"}
              </Button>
            </div>
          </div>
          )}

          {view === "templates" && (
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            {/* Templates header */}
            <div className="px-6 pt-5 pb-3 border-b border-border shrink-0">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                <Input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Search templates"
                  className="pl-9 h-8 text-xs bg-muted/30 border-border focus-visible:ring-primary/40"
                  autoFocus
                />
              </div>
            </div>

            {/* Template list */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-3">
                {filteredTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    className="w-full text-left p-3.5 rounded-lg border border-border bg-background hover:border-primary/30 hover:bg-primary/[0.03] transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-boldtracking-widest shrink-0 px-1.5 py-0.5 mt-0.5 border",
                          COMMAND_STYLES[tpl.command],
                        )}
                      >
                        {tpl.command}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
                          {tpl.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {tpl.description}
                        </p>
                        {(tpl.using || tpl.withCheck) && (
                          <div className="mt-2 space-y-1">
                            {tpl.using && (
                              <code className="block text-xs font-mono text-primary/70 bg-primary/5 px-2 py-0.5 rounded">
                                USING ({tpl.using})
                              </code>
                            )}
                            {tpl.withCheck && (
                              <code className="block text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded">
                                WITH CHECK ({tpl.withCheck})
                              </code>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {filteredTemplates.length === 0 && (
                <div className="py-10 text-center text-xs text-muted-foreground/50">
                  No templates match your search.
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
