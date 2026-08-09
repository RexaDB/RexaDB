// fallow-ignore-file code-duplication
"use client";

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Eye,
} from "@/lib/icon-theme/lucide-react";
import {
  SPACETIMEDB_COLUMN_TYPES,
} from "@/lib/db/column-types";
import {
  generateTableCode,
  LANGUAGE_LABELS,
  type ColumnDef,
  type SupportedLanguage,
  type SpacetimeDbColumnType,
} from "@/lib/db/spacetimedb-schema-builder";

interface TableBuilderProps {
  onClose?: () => void;
}

function newColumn(): ColumnDef {
  return {
    name: "",
    type: "U64" as SpacetimeDbColumnType,
    isPrimary: false,
    isUnique: false,
    autoInc: false,
    index: false,
  };
}

export function SpacetimeDBTableBuilder({ onClose }: TableBuilderProps) {
  const [tableName, setTableName] = useState("");
  const [access, setAccess] = useState<"public" | "private">("public");
  const [columns, setColumns] = useState<ColumnDef[]>([newColumn()]);
  const [activeLang, setActiveLang] = useState<SupportedLanguage>("rust");
  const [copied, setCopied] = useState(false);

  const tableDef = useMemo(() => ({
    name: tableName || "my_table",
    access,
    columns: columns.filter(c => c.name.trim()),
  }), [tableName, access, columns]);

  const code = useMemo(() => {
    if (!tableName.trim() || columns.every(c => !c.name.trim())) {
      return "// Define a table name and at least one column to see generated code";
    }
    return generateTableCode(activeLang, tableDef);
  }, [activeLang, tableDef, tableName, columns]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const addColumn = () => setColumns(prev => [...prev, newColumn()]);

  const removeColumn = (index: number) => {
    if (columns.length <= 1) return;
    setColumns(prev => prev.filter((_, i) => i !== index));
  };

  // fallow-ignore-next-line code-duplication
  const updateColumn = (index: number, updates: Partial<ColumnDef>) => {
    setColumns(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      if (updates.isPrimary) {
        updated.forEach((col, i) => {
          if (i !== index) col.isPrimary = false;
        });
      }
      if (updates.autoInc && !updates.isPrimary) {
        updated[index].isPrimary = true;
        updated.forEach((col, i) => {
          if (i !== index) col.isPrimary = false;
        });
      }
      return updated;
    });
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 min-w-0 border-r border-border p-5 overflow-y-auto">
          <div className="max-w-xl mx-auto space-y-5">
            <div className="space-y-3">
              <Label className="text-xs font-medium">Table Name</Label>
              <Input
                value={tableName}
                onChange={e => setTableName(e.target.value)}
                placeholder="e.g. player, user, inventory_item"
                className="font-mono text-sm"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Table Access</Label>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${access === "private" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  Private
                </span>
                <Switch
                  checked={access === "public"}
                  onCheckedChange={v => setAccess(v ? "public" : "private")}
                />
                <span className={`text-xs ${access === "public" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  Public
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Columns</Label>
                <Button variant="outline" size="sm" onClick={addColumn} className="h-7 text-xs">
                  <Plus className="w-3 h-3 mr-1" />
                  Add Column
                </Button>
              </div>

              <div className="space-y-2">
                {columns.map((col, i) => (
                  <div key={i} className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
                    <div className="grid grid-cols-[1fr_100px] gap-2">
                      <Input
                        value={col.name}
                        onChange={e => updateColumn(i, { name: e.target.value })}
                        placeholder="column_name"
                        className="font-mono text-xs h-8"
                      />
                      <div className="flex items-center gap-1">
                        <Select
                          value={col.type}
                          onValueChange={v => updateColumn(i, { type: v as SpacetimeDbColumnType })}
                        >
                          <SelectTrigger className="h-8 text-xs font-mono">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SPACETIMEDB_COLUMN_TYPES.map(t => (
                              <SelectItem key={t} value={t} className="font-mono text-xs">
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeColumn(i)}
                          disabled={columns.length <= 1}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.isPrimary}
                          onChange={e => updateColumn(i, { isPrimary: e.target.checked })}
                          className="accent-primary w-3.5 h-3.5"
                        />
                        <span className="text-xs text-muted-foreground">PK</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.autoInc}
                          onChange={e => updateColumn(i, { autoInc: e.target.checked })}
                          className="accent-primary w-3.5 h-3.5"
                        />
                        <span className="text-xs text-muted-foreground">Auto Inc</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.isUnique}
                          onChange={e => updateColumn(i, { isUnique: e.target.checked })}
                          className="accent-primary w-3.5 h-3.5"
                        />
                        <span className="text-xs text-muted-foreground">Unique</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.index}
                          onChange={e => updateColumn(i, { index: e.target.checked })}
                          className="accent-primary w-3.5 h-3.5"
                        />
                        <span className="text-xs text-muted-foreground">Index</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={addColumn}
              className="w-full h-8 text-xs border-dashed"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Column
            </Button>
          </div>
        </div>

        <div className="w-1/2 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Eye className="w-3.5 h-3.5" />
              Generated Code
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCopy}
            >
              {copied ? (
                <><Check className="w-3 h-3 mr-1 text-emerald-500" /> Copied</>
              ) : (
                <><Copy className="w-3 h-3 mr-1" /> Copy</>
              )}
            </Button>
          </div>

          <Tabs
            value={activeLang}
            onValueChange={v => setActiveLang(v as SupportedLanguage)}
            className="flex-1 flex flex-col"
          >
            <div className="px-4 pt-2">
              <TabsList className="h-8">
                {(["rust", "typescript", "csharp", "cpp"] as SupportedLanguage[]).map(lang => (
                  <TabsTrigger key={lang} value={lang} className="text-xs px-3 py-1">
                    {LANGUAGE_LABELS[lang]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {(["rust", "typescript", "csharp", "cpp"] as SupportedLanguage[]).map(lang => (
              <TabsContent key={lang} value={lang} className="flex-1 mt-0">
                <ScrollArea className="h-full">
                  <pre className="p-4 text-xs font-mono leading-relaxed text-foreground whitespace-pre overflow-x-auto">
                    <code>{code}</code>
                  </pre>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
