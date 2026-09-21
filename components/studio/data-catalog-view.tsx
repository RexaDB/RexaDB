"use client";

// Data Catalog — searchable table/column browser with descriptions and
// display decorators (Outerbase data-catalog / column-descriptor /
// data-decorator parity). Descriptions persist in the Rust backend
// (data-dictionary.json); native Postgres/MySQL comments are shown as the
// shared layer and can be pushed to from here on Postgres.

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Hash,
  KeyRound,
  Link,
  Pencil,
  RefreshCw,
  Search,
  Table2,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DatabaseTable,
  DatabaseTableBody,
  DatabaseTableCell,
  DatabaseTableHead,
  DatabaseTableHeader,
  DatabaseTableRow,
} from "./database/database-table";
import { SchemaDropdown } from "./database/schema-dropdown";
import { SelectFilter } from "./database/select-filter";
import { EmptyStatePresentational } from "./database/empty-state-presentational";
import { useDataDictionary } from "@/hooks/use-data-dictionary";
import {
  applyColumnDecorator,
  buildCatalogEntries,
  searchCatalog,
  tableKey,
} from "@/lib/dictionary/helpers";
import type {
  CatalogTableEntry,
  ColumnDecorator,
  NativeCommentMaps,
} from "@/lib/dictionary/types";
import { fetchNativeComments, setPostgresComment } from "@/lib/dictionary/native";

interface DataCatalogViewProps {
  connectionId: number;
  connectionString: string;
  dbType: string;
  schemas: string[];
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
  tables: string[];
  fetchColumns: (schema: string, table: string) => Promise<any[]>;
  onOpenTable?: (table: string) => void;
}

interface NormalizedColumn {
  column: string;
  dataType: string;
  isNullable: boolean;
  isPrimary: boolean;
  isForeignKey: boolean;
}

function normalizeStructureRow(row: any): NormalizedColumn | null {
  const column = String(row?.column_name ?? row?.name ?? "");
  if (!column) return null;
  const nullableRaw = row?.is_nullable;
  return {
    column,
    dataType: String(row?.data_type ?? row?.type ?? row?.udt_name ?? "unknown"),
    isNullable:
      nullableRaw === true ||
      String(nullableRaw ?? "").toUpperCase() === "YES" ||
      String(nullableRaw ?? "") === "1",
    isPrimary: Boolean(row?.is_primary_key ?? row?.is_primary ?? row?.isPrimary),
    isForeignKey: Boolean(row?.is_foreign_key ?? row?.is_foreign ?? row?.isForeignKey),
  };
}

// ---------------------------------------------------------------------------
// Description editor (popover)
// ---------------------------------------------------------------------------

function DescriptionPopover({
  value,
  source,
  placeholder,
  onSave,
  onPush,
  pushing,
  align = "start",
  className,
}: {
  value: string | null;
  source: "local" | "native" | null;
  placeholder: string;
  onSave: (next: string) => Promise<boolean>;
  onPush?: (description: string) => Promise<void>;
  pushing?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(value ?? "");
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`group/desc flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/60 ${className ?? ""}`}
          title={value ? "Edit description" : placeholder}
        >
          {value ? (
            <span className="min-w-0 flex-1 truncate text-foreground/80">{value}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground/45">{placeholder}</span>
          )}
          <Pencil className="size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover/desc:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align={align} side="bottom">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Description</span>
            <SourceBadge source={source} />
          </div>
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void handleSave();
            }}
            placeholder={placeholder}
            rows={3}
            className="text-xs"
          />
          <div className="flex items-center gap-2">
            {onPush && value && source === "local" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={pushing}
                      onClick={() => onPush(value)}
                    >
                      <Database className="size-3.5" />
                      {pushing ? "Pushing…" : "Push to DB"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Write to the database as a native COMMENT
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <span className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              <Check className="size-3.5" />
              Save
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-[11px] text-muted-foreground">⌘⏎ to save</p>
        </div>
      </PopoverContent>
    </Popover>
  );

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const ok = await onSave(draft.trim());
      if (ok) {
        setOpen(false);
      } else {
        setError("Save failed — please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed — please try again.");
    } finally {
      setSaving(false);
    }
  }
}

// ---------------------------------------------------------------------------
// Decorator editor (popover)
// ---------------------------------------------------------------------------

type DecoratorKind = ColumnDecorator["kind"] | "none";

const DECORATOR_KINDS: Array<{ value: DecoratorKind; label: string; hint: string }> = [
  { value: "none", label: "None", hint: "" },
  { value: "enum-map", label: "Value labels", hint: "Map raw values to friendly labels" },
  { value: "mask", label: "Mask (PII)", hint: "Hide leading characters" },
  { value: "prefix-suffix", label: "Prefix / suffix", hint: "Units, currency, affixes" },
  { value: "truncate", label: "Truncate", hint: "Shorten long text" },
  { value: "date-format", label: "Date format", hint: "Relative or calendar dates" },
];

function DecoratorCell({
  column,
  initial,
  onSave,
}: {
  column: string;
  initial: ColumnDecorator | null;
  onSave: (next: ColumnDecorator | null) => Promise<boolean>;
}) {
  const [paramsOpen, setParamsOpen] = useState(false);
  const [kind, setKind] = useState<DecoratorKind>(initial?.kind ?? "none");
  const [params, setParams] = useState<string>(() => serializeParams(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parent refresh after save flows back in as a new `initial`.
  useEffect(() => {
    if (!paramsOpen) {
      setKind(initial?.kind ?? "none");
      setParams(serializeParams(initial));
    }
  }, [initial, paramsOpen]);

  function serializeParams(decorator: ColumnDecorator | null): string {
    if (!decorator) return "";
    if (decorator.kind === "enum-map") {
      return Object.entries(decorator.mapping)
        .map(([k, v]) => `${k} = ${v}`)
        .join("\n");
    }
    if (decorator.kind === "mask") return String(decorator.visibleChars ?? 0);
    if (decorator.kind === "prefix-suffix") {
      return `${decorator.prefix ?? ""}|${decorator.suffix ?? ""}`;
    }
    if (decorator.kind === "truncate") return String(decorator.maxLength);
    if (decorator.kind === "date-format") return decorator.format;
    return "";
  }

  function buildDecorator(): ColumnDecorator | null {
    if (kind === "none") return null;
    if (kind === "enum-map") {
      const mapping: Record<string, string> = {};
      for (const line of params.split("\n")) {
        const idx = line.indexOf("=");
        if (idx <= 0) continue;
        const raw = line.slice(0, idx).trim();
        const label = line.slice(idx + 1).trim();
        if (raw && label) mapping[raw] = label;
      }
      if (Object.keys(mapping).length === 0) throw new Error("Add at least one `value = Label` line.");
      return { kind, mapping };
    }
    if (kind === "mask") {
      const visibleChars = Math.max(0, parseInt(params.trim() || "0", 10) || 0);
      return { kind, visibleChars };
    }
    if (kind === "prefix-suffix") {
      const [prefix = "", suffix = ""] = params.split("|");
      return { kind, prefix, suffix };
    }
    if (kind === "truncate") {
      const maxLength = parseInt(params.trim() || "0", 10);
      if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 10_000) {
        throw new Error("maxLength must be between 1 and 10000.");
      }
      return { kind, maxLength };
    }
    const format = (params.trim() || "datetime").toLowerCase();
    if (!["relative", "date", "datetime", "time"].includes(format)) {
      throw new Error("Format must be relative, date, datetime, or time.");
    }
    return { kind: "date-format", format };
  }

  let preview: string | null = null;
  if (kind !== "none") {
    try {
      preview = applyColumnDecorator(column, buildDecorator()).display;
    } catch {
      preview = null;
    }
  }

  return (
    <Popover
      open={paramsOpen}
      onOpenChange={(next) => {
        setParamsOpen(next);
        if (!next) {
          // Dismissed without saving — revert to the stored decorator.
          setKind(initial?.kind ?? "none");
          setParams(serializeParams(initial));
          setError(null);
        }
      }}
    >
      <PopoverAnchor asChild>
        <span className="block min-w-0" title={selectTitle()}>
          <Select
            value={kind}
            onValueChange={(v) => void handleKindChange(v as DecoratorKind)}
            disabled={saving}
          >
            <SelectTrigger className="h-7 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="end"
              side="bottom"
              sideOffset={4}
              searchThreshold={99}
            >
              {DECORATOR_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      </PopoverAnchor>
      <PopoverContent className="w-80 p-3" align="end" side="bottom">
        <div className="space-y-2.5">
          <span className="text-xs font-medium">
            {DECORATOR_KINDS.find((k) => k.value === kind)?.label} ·{" "}
            <code className="bg-muted px-1 rounded font-mono">{column}</code>
          </span>
          {kind !== "none" && (
            <>
              <p className="text-[11px] text-muted-foreground">
                {DECORATOR_KINDS.find((k) => k.value === kind)?.hint}
              </p>
              {kind === "enum-map" ? (
                <Textarea
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                  placeholder={"active = Active\nbanned = Banned"}
                  rows={3}
                  className="font-mono text-xs"
                />
              ) : (
                <Input
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                  placeholder={paramPlaceholder(kind)}
                  className="h-8 font-mono text-xs"
                />
              )}
              <div className="rounded-md bg-muted px-2.5 py-2 text-xs">
                <span className="text-muted-foreground">Preview: </span>
                <span className="font-mono text-foreground">{preview ?? "—"}</span>
              </div>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            {initial && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => void handleClear()}
              >
                Remove
              </Button>
            )}
            <span className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setParamsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              <Check className="size-3.5" />
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  function selectTitle(): string {
    if (initial) return `Display: ${initial.kind} — pick again to tune it`;
    return "Choose how values in this column display";
  }

  function paramPlaceholder(k: DecoratorKind): string {
    if (k === "mask") return "Visible trailing chars, e.g. 4";
    if (k === "prefix-suffix") return "prefix|suffix, e.g. $ | USD";
    if (k === "truncate") return "Max length, e.g. 80";
    return "relative, date, datetime, or time";
  }

  async function handleKindChange(next: DecoratorKind) {
    if (next === "none") {
      if (!initial) {
        setKind("none");
        return;
      }
      setSaving(true);
      try {
        const ok = await onSave(null);
        if (ok) {
          setKind("none");
        } else {
          toast.error("Could not clear the display setting.");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not clear the display setting.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (next === initial?.kind) {
      // Re-picking the stored kind just opens it for tweaking.
      openEditor(serializeParams(initial));
      return;
    }
    if (next === "enum-map") {
      // Labels need user input before anything can be saved — draft mode.
      // Deferred a tick: opening synchronously inside the Select's close
      // steals the dismiss event and the popover flashes shut again.
      setKind(next);
      setParams("");
      setError(null);
      globalThis.setTimeout(() => setParamsOpen(true), 0);
      return;
    }
    // Everything else has sane defaults, so the pick saves immediately and
    // the visible selection is always stored state — dismissing the tuning
    // popover can never lose it.
    const defaults = defaultDecorator(next);
    setSaving(true);
    try {
      const ok = await onSave(defaults);
      if (ok) {
        setKind(next);
        openEditor(serializeParams(defaults));
      } else {
        toast.error("Could not save the display setting.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the display setting.");
    } finally {
      setSaving(false);
    }
  }

  function openEditor(prefill: string) {
    setParams(prefill);
    setError(null);
    globalThis.setTimeout(() => setParamsOpen(true), 0);
  }

  function defaultDecorator(next: DecoratorKind): ColumnDecorator | null {
    if (next === "mask") return { kind: "mask", visibleChars: 0 };
    if (next === "truncate") return { kind: "truncate", maxLength: 80 };
    if (next === "date-format") return { kind: "date-format", format: "datetime" };
    if (next === "prefix-suffix") return { kind: "prefix-suffix", prefix: "", suffix: "" };
    return null;
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const next = buildDecorator();
      const ok = await onSave(next);
      if (ok) {
        setParamsOpen(false);
      } else {
        setError("Save failed — please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid decorator.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setError(null);
    setSaving(true);
    try {
      const ok = await onSave(null);
      if (ok) {
        setParamsOpen(false);
      } else {
        setError("Save failed — please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed — please try again.");
    } finally {
      setSaving(false);
    }
  }
}

function SourceBadge({ source }: { source: "local" | "native" | null }) {
  if (!source) return null;
  const isLocal = source === "local";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant={isLocal ? "secondary" : "outline"}>
              {isLocal ? "RexaDB" : "Database"}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {isLocal
            ? "Described in RexaDB (local to this connection)"
            : "From the database (native comment)"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

const COVERAGE_OPTIONS = [
  { label: "Described", value: "described" },
  { label: "Undescribed", value: "undescribed" },
  { label: "Decorated", value: "decorated" },
];

export function DataCatalogView({
  connectionId,
  connectionString,
  dbType,
  schemas,
  selectedSchema,
  onSchemaChange,
  tables,
  fetchColumns,
  onOpenTable,
}: DataCatalogViewProps) {
  const { scope, loading: dictLoading, saveTable, saveColumn, saveDecorator } =
    useDataDictionary(connectionId);
  const [query, setQuery] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [structures, setStructures] = useState<Record<string, NormalizedColumn[]>>({});
  const [loadingTables, setLoadingTables] = useState<Record<string, boolean>>({});
  const [native, setNative] = useState<NativeCommentMaps>({ tables: {}, columns: {} });
  const [nativeLoading, setNativeLoading] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);

  const supportsNative = ["postgres", "postgresql", "supabase-mgmt", "mysql", "mariadb"].includes(
    String(dbType || "").toLowerCase(),
  );
  const canPushNative = ["postgres", "postgresql", "supabase-mgmt"].includes(
    String(dbType || "").toLowerCase(),
  );

  useEffect(() => {
    setExpanded({});
    setStructures({});
    if (!supportsNative || !connectionString) {
      setNative({ tables: {}, columns: {} });
      return;
    }
    let cancelled = false;
    setNativeLoading(true);
    fetchNativeComments(connectionString, dbType, selectedSchema)
      .then((maps) => {
        if (!cancelled) setNative(maps);
      })
      .finally(() => {
        if (!cancelled) setNativeLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionString, dbType, selectedSchema]);

  const entries: CatalogTableEntry[] = useMemo(
    () =>
      buildCatalogEntries(
        tables.map((table) => ({
          schema: selectedSchema,
          table,
          columns: (structures[tableKey(selectedSchema, table)] || []).map((c) => ({
            column: c.column,
            dataType: c.dataType,
            isNullable: c.isNullable,
            isPrimary: c.isPrimary,
            isForeignKey: c.isForeignKey,
          })),
        })),
        scope,
        native,
      ),
    [tables, selectedSchema, structures, scope, native],
  );

  const hits = useMemo(() => searchCatalog(entries, query), [entries, query]);

  const visibleTables = useMemo(() => {
    let list = entries;
    if (query.trim()) {
      const tableHits = new Set(
        hits.filter((h) => h.kind === "table").map((h) => tableKey(h.schema, h.table)),
      );
      const columnTables = new Set(
        hits.filter((h) => h.kind === "column").map((h) => tableKey(h.schema, h.table)),
      );
      list = list.filter(
        (e) =>
          tableHits.has(tableKey(e.schema, e.table)) ||
          columnTables.has(tableKey(e.schema, e.table)),
      );
    }
    if (coverageFilter.length > 0) {
      list = list.filter((e) => {
        const checks: boolean[] = [];
        if (coverageFilter.includes("described")) checks.push(Boolean(e.description));
        if (coverageFilter.includes("undescribed")) checks.push(!e.description);
        if (coverageFilter.includes("decorated")) {
          checks.push(e.columns.some((c) => c.decorator));
        }
        return checks.some(Boolean);
      });
    }
    return list;
  }, [entries, hits, query, coverageFilter]);

  const columnFilter = useMemo(() => {
    if (!query.trim()) return null;
    const map = new Map<string, Set<string>>();
    for (const h of hits) {
      if (h.kind !== "column" || !h.column) continue;
      const key = tableKey(h.schema, h.table);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(h.column);
    }
    return map;
  }, [hits, query]);

  const documentedTables = entries.filter((e) => e.description).length;
  const documentedColumns = entries.reduce(
    (n, e) => n + e.columns.filter((c) => c.description).length,
    0,
  );
  const totalColumns = entries.reduce((n, e) => n + e.columns.length, 0);

  async function ensureStructure(table: string) {
    const key = tableKey(selectedSchema, table);
    if (structures[key] || loadingTables[key]) return;
    setLoadingTables((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetchColumns(selectedSchema, table);
      const rows = Array.isArray(res) ? res : (res as any)?.data || (res as any)?.rows || [];
      const normalized = (Array.isArray(rows) ? rows : [])
        .map(normalizeStructureRow)
        .filter((c): c is NormalizedColumn => c !== null);
      setStructures((prev) => ({ ...prev, [key]: normalized }));
    } catch {
      setStructures((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setLoadingTables((prev) => ({ ...prev, [key]: false }));
    }
  }

  function toggleExpand(table: string) {
    const key = tableKey(selectedSchema, table);
    setExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (next[key]) void ensureStructure(table);
      return next;
    });
  }

  // Search hits auto-expand so matching columns are visible (and loaded).
  useEffect(() => {
    if (!columnFilter) return;
    for (const table of tables) {
      if (columnFilter.has(tableKey(selectedSchema, table))) void ensureStructure(table);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilter]);

  function reloadNative() {
    if (!supportsNative || !connectionString) return;
    setNativeLoading(true);
    fetchNativeComments(connectionString, dbType, selectedSchema)
      .then(setNative)
      .finally(() => setNativeLoading(false));
  }

  async function handlePush(
    key: string,
    args: { kind: "table" | "column"; table: string; column?: string; comment: string },
  ) {
    setPushing(key);
    try {
      const res = await setPostgresComment({ connectionString, ...args, schema: selectedSchema });
      if (res.success) {
        const maps = await fetchNativeComments(connectionString, dbType, selectedSchema);
        setNative(maps);
      }
    } finally {
      setPushing(null);
    }
  }

  if (dictLoading && entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
        <div className="p-8 pb-4">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-72" />
        </div>
        <div className="px-8 pb-4 flex gap-2">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-8 w-52 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
        </div>
        <div className="px-8 flex-1 overflow-hidden flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-studio-bg overflow-hidden">
      <div className="p-8 pb-4">
        <h1 className="text-sm font-semibold text-foreground tracking-tight">Data Catalog</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Describe tables and columns in{" "}
          <code className="bg-muted px-1 rounded">{selectedSchema}</code>
          {" · "}
          {documentedTables}/{tables.length} tables
          {totalColumns > 0 && (
            <>
              {" · "}
              {documentedColumns}/{totalColumns} columns
            </>
          )}{" "}
          documented
        </p>
      </div>

      <div className="px-8 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">
          <SchemaDropdown
            schemas={schemas}
            selectedSchema={selectedSchema}
            onSchemaChange={onSchemaChange}
            showAllOption={false}
          />
          <div className="relative w-full lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <Input
              placeholder="Search tables, columns, descriptions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-8 bg-background border-border text-xs"
            />
          </div>
          <SelectFilter
            label="Coverage"
            options={COVERAGE_OPTIONS}
            value={coverageFilter}
            onChange={setCoverageFilter}
          />
        </div>
        <div className="flex items-center gap-2">
          {supportsNative && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={reloadNative} disabled={nativeLoading}>
                    <RefreshCw className={`size-3.5 ${nativeLoading ? "animate-spin" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reload native database comments</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div className="px-8 flex-1 overflow-hidden flex flex-col">
        {visibleTables.length === 0 ? (
          <EmptyStatePresentational
            icon={query.trim() ? Search : Database}
            title={query.trim() ? "No matching tables or columns" : `No tables in ${selectedSchema}`}
            description={
              query.trim()
                ? "Try a different search term, or clear the coverage filter."
                : "Tables in this schema will appear here once they exist."
            }
          />
        ) : (
          <div className="flex-1 overflow-y-auto pb-8 space-y-3">
            {visibleTables.map((entry) => {
              const key = tableKey(entry.schema, entry.table);
              const isOpen = !!expanded[key] || (!!columnFilter && columnFilter.has(key));
              const shownCols = columnFilter?.get(key)
                ? entry.columns.filter((c) => columnFilter.get(key)!.has(c.column))
                : entry.columns;
              const colCount = entry.columns.length;
              const describedCount = entry.columns.filter((c) => c.description).length;
              const coverage =
                colCount > 0 ? Math.round((describedCount / colCount) * 100) : null;
              return (
                <div key={key} className="rounded-lg border border-border overflow-hidden">
                  <div className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.table)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="p-1.5 bg-primary/10 rounded-lg shrink-0">
                        <Table2 className="size-4 text-primary" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold tracking-tight">
                          {entry.table}
                        </span>
                        {entry.description ? (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {entry.description}
                          </span>
                        ) : (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground/50">
                            No description yet
                          </span>
                        )}
                      </span>
                    </button>
                    <span className="hidden sm:flex items-center gap-1.5 shrink-0">
                      <Badge variant="secondary">
                        {colCount} {colCount === 1 ? "column" : "columns"}
                      </Badge>
                      {coverage !== null && (
                        <Badge variant={coverage === 100 ? "default" : "outline"}>
                          {coverage}% described
                        </Badge>
                      )}
                      <SourceBadge source={entry.descriptionSource} />
                    </span>
                    {onOpenTable && (
                      <button
                        type="button"
                        onClick={() => onOpenTable(entry.table)}
                        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        title="Open table"
                      >
                        Open
                        <ArrowRight className="size-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="border-t border-border/60 px-4 py-2.5 bg-muted/20">
                    <DescriptionPopover
                      value={entry.description}
                      source={entry.descriptionSource}
                      placeholder="Add a table description…"
                      onSave={(next) => saveTable(entry.schema, entry.table, next)}
                      onPush={
                        canPushNative
                          ? (desc) =>
                              handlePush(`push-table:${entry.table}`, {
                                kind: "table",
                                table: entry.table,
                                comment: desc,
                              })
                          : undefined
                      }
                      pushing={pushing === `push-table:${entry.table}`}
                    />
                  </div>

                  {isOpen && (
                    <div className="border-t border-border/60">
                      {loadingTables[key] ? (
                        <div className="px-4 py-3 space-y-2">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-8 w-full" />
                          ))}
                        </div>
                      ) : shownCols.length === 0 ? (
                        <p className="px-4 py-4 text-xs text-muted-foreground">
                          {query.trim()
                            ? "No columns match your search."
                            : "No columns loaded for this table."}
                        </p>
                      ) : (
                        <DatabaseTable>
                          <DatabaseTableHeader>
                            <DatabaseTableRow>
                              <DatabaseTableHead className="w-[220px]">Column</DatabaseTableHead>
                              <DatabaseTableHead className="w-[150px]">Type</DatabaseTableHead>
                              <DatabaseTableHead className="w-[90px]">Nullable</DatabaseTableHead>
                              <DatabaseTableHead>Description</DatabaseTableHead>
                              <DatabaseTableHead className="w-[170px] text-right">
                                Display
                              </DatabaseTableHead>
                            </DatabaseTableRow>
                          </DatabaseTableHeader>
                          <DatabaseTableBody>
                            {shownCols.map((col) => (
                              <DatabaseTableRow key={col.column}>
                                <DatabaseTableCell className="py-2.5">
                                  <span className="flex items-center gap-1.5">
                                    {col.isPrimary ? (
                                      <KeyRound className="size-3.5 shrink-0 text-amber-400" />
                                    ) : (
                                      <Hash className="size-3.5 shrink-0 text-muted-foreground/50" />
                                    )}
                                    <span className="truncate text-xs font-medium">
                                      {col.column}
                                    </span>
                                    {col.isForeignKey && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span>
                                              <Link className="size-3 shrink-0 text-muted-foreground/60" />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent side="top">Foreign key</TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                  </span>
                                </DatabaseTableCell>
                                <DatabaseTableCell className="py-2.5">
                                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">
                                    {col.dataType}
                                  </code>
                                </DatabaseTableCell>
                                <DatabaseTableCell className="py-2.5">
                                  <span className="text-xs text-muted-foreground">
                                    {col.isNullable ? "NULL" : "NOT NULL"}
                                  </span>
                                </DatabaseTableCell>
                                <DatabaseTableCell className="py-2.5">
                                  <span className="flex items-center gap-1.5">
                                    <span className="min-w-0 flex-1">
                                      <DescriptionPopover
                                        value={col.description}
                                        source={col.descriptionSource}
                                        placeholder="Add…"
                                        onSave={(next) =>
                                          saveColumn(entry.schema, entry.table, col.column, next)
                                        }
                                        onPush={
                                          canPushNative
                                            ? (desc) =>
                                                handlePush(
                                                  `push-column:${entry.table}.${col.column}`,
                                                  {
                                                    kind: "column",
                                                    table: entry.table,
                                                    column: col.column,
                                                    comment: desc,
                                                  },
                                                )
                                            : undefined
                                        }
                                        pushing={
                                          pushing ===
                                          `push-column:${entry.table}.${col.column}`
                                        }
                                      />
                                    </span>
                                    <SourceBadge source={col.descriptionSource} />
                                  </span>
                                </DatabaseTableCell>
                                <DatabaseTableCell className="py-2.5 text-right">
                                  <DecoratorCell
                                    column={col.column}
                                    initial={col.decorator}
                                    onSave={(next) =>
                                      saveDecorator(entry.schema, entry.table, col.column, next)
                                    }
                                  />
                                </DatabaseTableCell>
                              </DatabaseTableRow>
                            ))}
                          </DatabaseTableBody>
                        </DatabaseTable>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
