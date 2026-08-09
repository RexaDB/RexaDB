"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  Loader2,
  Shield,
  Zap,
  Database,
  ChevronDown,
  Info,
  AlertTriangle,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityIcon } from "./advisor-shared";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AdvisorResult, AdvisorSeverity } from "@/lib/db/advisor/types";
import { AdvisorDetailSheet } from "./advisor-detail-sheet";
import { AdvisorDisabledState } from "./advisor-disabled-state";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection";

// ─── Entity helpers ────────────────────────────────────────────────────────────

function getEntityLabel(checkId: string, row: any): string {
  switch (checkId) {
    case "tables-without-rls":
    case "tables-without-pk":
    case "rls-policies-missing":
    case "missing-foreign-key-indexes":
      return `${row.schema_name}.${row.table_name}`;
    case "superuser-roles":
      return row.role_name;
    case "slow-queries":
      return ((row.query as string) || "").substring(0, 60).replace(/\s+/g, " ").trim();
    case "unused-indexes":
      return `${row.schemaname}.${row.indexname}`;
    case "table-bloat":
    case "cache-hit-ratio":
      return `${row.schemaname}.${row.table_name}`;
    case "missing-indexes-on-fk":
      return `${row.schema_name}.${row.table_name}(${row.column_name})`;
    case "disabled-triggers":
      return `${row.schema_name}.${row.table_name}.${row.trigger_name}`;
    case "indexes-on-low-cardinality":
      return `${row.schema_name}.${row.index_name}`;
    case "duplicate-index":
      return `${row.schema_name}.${row.table_name}`;
    case "multiple-permissive-policies":
      return `${row.schema_name}.${row.table_name} (${row.role_name}, ${row.command})`;
    case "auth-rls-initplan":
      return `${row.schema_name}.${row.table_name}.${row.policy_name}`;
    case "function-search-path-mutable":
    case "security-definer-public":
    case "security-definer-authenticated":
      return row.args
        ? `${row.schema_name}.${row.function_name}(${row.args})`
        : `${row.schema_name}.${row.function_name}`;
    case "leaked-password-protection":
      return row.entity || "Auth";
    default:
      return "";
  }
}

function CheckIcon({ category, className }: { category: string; className?: string }) {
  switch (category) {
    case "security":
      return <Shield className={className} />;
    case "performance":
      return <Zap className={className} />;
    default:
      return <Database className={className} />;
  }
}

// ─── Data helpers ──────────────────────────────────────────────────────────────

interface FlatRow {
  result: AdvisorResult;
  entity: string;
  rowKey: string;
}

function buildFlatRows(
  results: AdvisorResult[],
  severity: AdvisorSeverity,
  category: string,
  filter: Set<string>,
): FlatRow[] {
  return results
    .filter((r) => {
      if (r.passed || r.check.severity !== severity) return false;
      if (category !== "all" && r.check.category !== category) return false;
      if (filter.size > 0 && !filter.has(r.check.title)) return false;
      return true;
    })
    .flatMap((result) => {
      const rows = result.rows || [];
      if (rows.length === 0) {
        return [{ result, entity: result.check.title, rowKey: result.check.id }];
      }
      return rows.map((row, i) => ({
        result,
        entity: getEntityLabel(result.check.id, row),
        rowKey: `${result.check.id}-${i}`,
      }));
    });
}

function countEntities(results: AdvisorResult[], severity: AdvisorSeverity): number {
  return results
    .filter((r) => !r.passed && r.check.severity === severity)
    .reduce((sum, r) => sum + Math.max(r.rows?.length ?? 0, 1), 0);
}

// ─── Resizable column header ───────────────────────────────────────────────────

function ResizableTh({
  children,
  width,
  onWidthChange,
  isLast = false,
}: {
  children: React.ReactNode;
  width?: number;
  onWidthChange?: (w: number) => void;
  isLast?: boolean;
}) {
  const startX = useRef(0);
  const startW = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!onWidthChange || !width) return;
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = width;
    preventTextSelection();

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(80, startW.current + (ev.clientX - startX.current));
      onWidthChange(next);
    };
    const onUp = () => {
      allowTextSelection();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
  };

  return (
    <th
      className={cn(
        "h-10 p-0 text-left border-b border-studio-border bg-table-header-bg select-none relative",
        !isLast && "border-r",
      )}
      style={width ? { width } : undefined}
    >
      <div className="px-4 h-full flex items-center">
        <span className="text-xs font-medium text-studio-cell-text truncate">{children}</span>
      </div>
      {!isLast && onWidthChange && (
        <div
          className="absolute top-0 right-0 h-full w-2 cursor-col-resize z-10 group"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute right-0 top-2 bottom-2 w-px bg-transparent group-hover:bg-blue-500/60 transition-colors" />
        </div>
      )}
    </th>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function AdvisorView({
  connectionString,
  dbType,
}: {
  connectionString: string;
  dbType: string;
}) {
  const [results, setResults] = useState<AdvisorResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSeverity, setActiveSeverity] = useState<AdvisorSeverity>("warning");
  const [selectedResult, setSelectedResult] = useState<AdvisorResult | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pendingFilter, setPendingFilter] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [colWidths, setColWidths] = useState({ issueType: 280, entity: 240 });

  const isPostgres = dbType === "postgresql" || dbType === "postgres" || dbType === "supabase-mgmt";

  const runChecks = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    try {
      const { runAdvisorChecks } = await import("@/lib/api/actions-client");
      const res = await runAdvisorChecks(connectionString);
      if (res.success && res.data) {
        setResults(res.data.results);
        if (res.data.error) setError(res.data.error);
      } else {
        setError(res.error || "Failed to run advisor checks");
      }
    } catch (err: any) {
      setError(err.message || "Failed to run advisor checks");
    } finally {
      setIsRunning(false);
    }
  }, [connectionString]);

  useEffect(() => {
    if (isPostgres) runChecks();
  }, [isPostgres, runChecks]);

  if (!isPostgres) return <AdvisorDisabledState />;

  const criticalCount = countEntities(results, "critical");
  const warningCount = countEntities(results, "warning");
  const infoCount = countEntities(results, "info");

  const categoryTabs = ["all", "security", "performance", "schema"].map((cat) => ({
    value: cat,
    label: cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1),
    count: results
      .filter(
        (r) =>
          !r.passed &&
          r.check.severity === activeSeverity &&
          (cat === "all" || r.check.category === cat),
      )
      .reduce((sum, r) => sum + Math.max(r.rows?.length ?? 0, 1), 0),
  }));

  const flatRows = buildFlatRows(results, activeSeverity, activeCategory, activeFilter);

  // All unique check titles for the active severity + category
  const filterOptions = Array.from(
    new Set(
      results
        .filter(
          (r) =>
            !r.passed &&
            r.check.severity === activeSeverity &&
            (activeCategory === "all" || r.check.category === activeCategory),
        )
        .map((r) => r.check.title),
    ),
  );

  const TABS: {
    value: AdvisorSeverity;
    label: string;
    sub: string;
    dot: string;
    count: number;
  }[] = [
    {
      value: "critical",
      label: "Errors",
      sub: `${criticalCount} error${criticalCount !== 1 ? "s" : ""}`,
      dot: "bg-red-500",
      count: criticalCount,
    },
    {
      value: "warning",
      label: "Warnings",
      sub: `${warningCount} warning${warningCount !== 1 ? "s" : ""}`,
      dot: "bg-amber-500",
      count: warningCount,
    },
    {
      value: "info",
      label: "Info",
      sub: `${infoCount} suggestion${infoCount !== 1 ? "s" : ""}`,
      dot: "bg-green-500",
      count: infoCount,
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Severity tabs ── */}
      <div className="flex shrink-0 border-b border-studio-border">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setActiveSeverity(tab.value);
              setActiveCategory("all");
              setActiveFilter(new Set());
              setPendingFilter(new Set());
            }}
            className={cn(
              "flex items-center gap-2.5 px-5 py-3 border-b-2 transition-colors text-left shrink-0",
              activeSeverity === tab.value
                ? "border-foreground"
                : "border-transparent hover:border-muted-foreground/20",
            )}
          >
            <div className={cn("w-3 h-3 rounded-[3px] shrink-0", tab.dot)} />
            <div>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "text-sm font-medium leading-none",
                    activeSeverity === tab.value ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {tab.label}
                </span>
                <Info className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              </div>
              <div className="text-xs text-muted-foreground mt-1 leading-none">{tab.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-studio-border">
        {/* Category tabs */}
        <div className="flex items-center gap-0.5">
          {categoryTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveCategory(tab.value)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                activeCategory === tab.value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {tab.label}
              <span className="tabular-nums text-muted-foreground">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Filter popover */}
          <Popover
          open={filterOpen}
          onOpenChange={(open) => {
            setFilterOpen(open);
            if (open) setPendingFilter(new Set(activeFilter));
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-1.5 h-7 text-xs",
                activeFilter.size > 0 && "border-primary text-primary",
              )}
            >
              Filter
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0" sideOffset={4}>
            <div className="px-3 py-2.5 border-b border-studio-border">
              <p className="text-xs text-muted-foreground">Select filter</p>
            </div>
            <div className="py-1 max-h-72 overflow-y-auto">
              {filterOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-2">No options</p>
              ) : (
                filterOptions.map((title) => (
                  <label
                    key={title}
                    className="flex items-start gap-3 px-3 py-2.5 hover:bg-studio-row-hover cursor-pointer"
                  >
                    <Checkbox
                      checked={pendingFilter.has(title)}
                      onCheckedChange={(checked) => {
                        const next = new Set(pendingFilter);
                        if (checked) next.add(title);
                        else next.delete(title);
                        setPendingFilter(next);
                      }}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="text-xs leading-snug">{title}</span>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-studio-border">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setPendingFilter(new Set());
                }}
              >
                Clear
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setActiveFilter(new Set(pendingFilter));
                  setFilterOpen(false);
                }}
              >
                Save
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={runChecks}
            disabled={isRunning}
            className="gap-1.5 h-7 text-xs"
          >
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {isRunning ? "Running..." : "Refresh"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs">
            Export
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-start gap-3 mx-4 mt-3 shrink-0 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}

      {/* ── Grid ── */}
      <div className="flex-1 overflow-auto min-h-0">
        {isRunning && results.length === 0 ? (
          <table className="w-full border-collapse table-fixed">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="h-10 bg-table-header-bg border-b border-r border-studio-border" style={{ width: colWidths.issueType }} />
                <th className="h-10 bg-table-header-bg border-b border-r border-studio-border" style={{ width: colWidths.entity }} />
                <th className="h-10 bg-table-header-bg border-b border-studio-border" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 14 }).map((_, i) => (
                <tr key={i} className="border-b border-studio-border/40">
                  <td className="px-4 py-3 border-r border-studio-border/40">
                    <Skeleton className="h-3 w-4/5" />
                  </td>
                  <td className="px-4 py-3 border-r border-studio-border/40">
                    <Skeleton className="h-3 w-3/4" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-3 w-full" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col style={{ width: colWidths.issueType }} />
              <col style={{ width: colWidths.entity }} />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <ResizableTh
                  width={colWidths.issueType}
                  onWidthChange={(w) => setColWidths((prev) => ({ ...prev, issueType: w }))}
                >
                  Issue type
                </ResizableTh>
                <ResizableTh
                  width={colWidths.entity}
                  onWidthChange={(w) => setColWidths((prev) => ({ ...prev, entity: w }))}
                >
                  Entity/item
                </ResizableTh>
                <ResizableTh isLast>Description</ResizableTh>
              </tr>
            </thead>
            <tbody>
              {flatRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="h-28 text-center text-sm text-muted-foreground">
                    {isRunning
                      ? "Running checks…"
                      : `No ${activeSeverity === "critical" ? "errors" : activeSeverity === "warning" ? "warnings" : "suggestions"}`}
                  </td>
                </tr>
              ) : (
                flatRows.map(({ result, entity, rowKey }) => (
                  <tr
                    key={rowKey}
                    className="border-b border-studio-border/40 hover:bg-studio-row-hover cursor-pointer group"
                    onClick={() => {
                      setSelectedResult(result);
                      setSelectedEntity(entity);
                      setSheetOpen(true);
                    }}
                  >
                    <td className="h-9 px-4 border-r border-studio-border/40 align-middle">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckIcon
                          category={result.check.category}
                          className="w-3 h-3 shrink-0 text-muted-foreground"
                        />
                        <span className="font-mono text-xs text-foreground/90 truncate">
                          {result.check.title}
                        </span>
                      </div>
                    </td>
                    <td className="h-9 px-4 border-r border-studio-border/40 align-middle">
                      <div className="flex items-center gap-2 min-w-0">
                        <EntityIcon
                          checkId={result.check.id}
                          className="w-3 h-3 shrink-0 text-muted-foreground"
                        />
                        <span className="font-mono text-xs text-foreground/90 truncate">
                          {entity}
                        </span>
                      </div>
                    </td>
                    <td className="h-9 px-4 align-middle">
                      <span className="text-xs text-muted-foreground truncate block">
                        {result.check.description}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <AdvisorDetailSheet
        result={selectedResult}
        entity={selectedEntity}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
