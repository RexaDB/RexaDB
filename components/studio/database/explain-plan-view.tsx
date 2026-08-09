"use client";

import {
  Brain,
  Loader2,
  ChevronRight,
  ChevronDown,
  Clock,
  Database,
  Zap,
  HardDrive,
  AlertTriangle,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

interface PlanNode {
  "Node Type": string;
  Strategy?: string;
  "Join Type"?: string;
  "Relation Name"?: string;
  Schema?: string;
  Alias?: string;
  "Startup Cost": number;
  "Total Cost": number;
  "Plan Rows": number;
  "Plan Width": number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  Output?: string[];
  Filter?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Hash Cond"?: string;
  "Merge Cond"?: string;
  "Join Filter"?: string;
  "Subplan Name"?: string;
  Relation?: string;
  "Group Key"?: string[];
  "Sort Key"?: string[];
  "Sort Method"?: string;
  "Sort Space Used"?: number;
  "Sort Space Type"?: string;
  "Workers Planned"?: number;
  "Workers Launched"?: number;
  "Single Copy"?: boolean;
  Plans?: PlanNode[];
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: any[];
}

interface ExplainResult {
  "Query Text"?: string;
  "Query Plan"?: PlanNode;
  Plan?: PlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: any[];
  JIT?: {
    Functions: number;
    Options: Record<string, boolean>;
    Timing: Record<string, number>;
  };
}

interface ExplainPlanViewProps {
  connectionString: string;
  initialQuery?: string;
}

export function getPlanNode(plan: ExplainResult | null): PlanNode | null {
  if (!plan) return null;
  return (plan as any)["Query Plan"] || (plan as any)["Plan"] || null;
}

export function extractExplainPlan(row: Record<string, any>): ExplainResult | null {
  const firstVal = Object.values(row)[0];
  if (typeof firstVal !== "object" || firstVal === null) return null;
  const arr = Array.isArray(firstVal) ? firstVal : [firstVal];
  const candidate = arr[0] as any;
  if (candidate?.["Query Plan"] || candidate?.["Plan"]) {
    return candidate as ExplainResult;
  }
  return null;
}

export type { ExplainResult, PlanNode };

export function PlanNodeCard({
  node,
  depth = 0,
}: {
  node: PlanNode;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.Plans && node.Plans.length > 0;
  const hasActual = node["Actual Total Time"] !== undefined;

  const costColor =
    node["Actual Total Time"] !== undefined
      ? node["Actual Total Time"] > 1000
        ? "text-red-500"
        : node["Actual Total Time"] > 100
          ? "text-amber-500"
          : "text-emerald-500"
      : node["Total Cost"] > 10000
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "border-l-2",
        depth === 0 ? "border-primary/40" : "border-studio-border",
      )}
    >
      <div
        className="flex items-start gap-2 py-1.5 px-3 cursor-pointer hover:bg-muted/10 rounded-lg transition-colors"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        {hasChildren && (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
        {!hasChildren && <span className="w-3 shrink-0" />}

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground font-mono">
              {node["Node Type"]}
            </span>
            {node["Relation Name"] && (
              <span className="text-xs text-muted-foreground font-mono">
                on {node["Relation Name"]}
              </span>
            )}
            {node["Index Name"] && (
              <span className="text-xs text-muted-foreground font-mono">
                using {node["Index Name"]}
              </span>
            )}
            {node["Join Type"] && (
              <Badge
                variant="outline"
                className="text-xs h-4 px-1 font-normal border-studio-border"
              >
                {node["Join Type"]}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs flex-wrap">
            {hasActual ? (
              <>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-2.5 h-2.5" />
                  <span className={cn("font-mono", costColor)}>
                    {node["Actual Total Time"]!.toFixed(2)}ms
                  </span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Database className="w-2.5 h-2.5" />
                  <span className="font-mono">{node["Actual Rows"]} rows</span>
                </span>
                {node["Actual Loops"] && node["Actual Loops"] > 1 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Zap className="w-2.5 h-2.5" />
                    <span className="font-mono">
                      {node["Actual Loops"]} loops
                    </span>
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-muted-foreground font-mono">
                  Cost: {node["Startup Cost"].toFixed(2)}..
                  {node["Total Cost"].toFixed(2)}
                </span>
                <span className="text-muted-foreground font-mono">
                  Rows: {node["Plan Rows"]}
                </span>
              </>
            )}
          </div>

          {expanded && (
            <div className="pt-1 space-y-0.5">
              {node["Filter"] && (
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground/60">Filter:</span>{" "}
                  <span className="font-mono text-amber-500/80">
                    {node["Filter"]}
                  </span>
                </div>
              )}
              {node["Index Cond"] && (
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground/60">Index Cond:</span>{" "}
                  <span className="font-mono text-blue-400/80">
                    {node["Index Cond"]}
                  </span>
                </div>
              )}
              {node["Hash Cond"] && (
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground/60">Hash Cond:</span>{" "}
                  <span className="font-mono text-blue-400/80">
                    {node["Hash Cond"]}
                  </span>
                </div>
              )}
              {node["Merge Cond"] && (
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground/60">Merge Cond:</span>{" "}
                  <span className="font-mono text-blue-400/80">
                    {node["Merge Cond"]}
                  </span>
                </div>
              )}
              {node["Sort Method"] && (
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground/60">Sort:</span>{" "}
                  <span className="font-mono">{node["Sort Method"]}</span>
                  {node["Sort Space Used"] && (
                    <span className="font-mono">
                      {" "}
                      ({node["Sort Space Used"]}kB)
                    </span>
                  )}
                </div>
              )}
              {node["Workers Launched"] !== undefined && (
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground/60">Workers:</span>{" "}
                  <span className="font-mono">
                    {node["Workers Launched"]}/{node["Workers Planned"]}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {expanded && hasChildren && (
        <div className="pb-1">
          {node.Plans!.map((child, i) => (
            <PlanNodeCard key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplainPlanView({
  connectionString,
  initialQuery,
}: ExplainPlanViewProps) {
  const [query, setQuery] = useState(initialQuery || "");
  const [plan, setPlan] = useState<ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planQuery, setPlanQuery] = useState<string>("");

  const handleExplain = useCallback(async () => {
    if (!query.trim()) {
      toast.error("Enter a query first");
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const { fetchExplainPlan } = await import("@/lib/api/actions-client");
      const res = await fetchExplainPlan(connectionString, query);
      if (res.success && res.data) {
        const result = res.data;
        setPlanQuery((res.planQuery as string) || "");

        if (result.rows && result.rows.length > 0) {
          const firstRow = result.rows[0];
          const plan = extractExplainPlan(firstRow);

          if (plan) {
            setPlan(plan);
          } else {
            const firstVal = Object.values(firstRow)[0];
            if (typeof firstVal === "string") {
              const trimmed = firstVal.trim();
              let parsed: ExplainResult | null = null;
              try {
                if (trimmed.startsWith("[")) {
                  const arr = JSON.parse(trimmed);
                  if (Array.isArray(arr) && arr.length > 0) {
                    parsed = arr[0];
                  }
                } else if (trimmed.startsWith("{")) {
                  parsed = JSON.parse(trimmed);
                }
              } catch {}

              if (parsed && (parsed["Query Plan"] || parsed["Plan"])) {
                setPlan(parsed);
              } else if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
                setPlan(null);
                try {
                  setError(JSON.stringify(JSON.parse(trimmed), null, 2));
                } catch {
                  setError(trimmed);
                }
              } else {
                setPlan(null);
                setError(trimmed);
              }
            } else {
              setPlan(null);
              setError(String(firstVal));
            }
          }
        } else {
          setError("No results from EXPLAIN. Check your query.");
        }
      } else {
        setError(res.error || "Failed to generate explain plan");
      }
    } catch (e: any) {
      setError(e.message || "Failed to generate explain plan");
    } finally {
      setLoading(false);
    }
  }, [connectionString, query]);

  return (
    <div className="flex-1 overflow-y-auto bg-studio-bg">
      <div className="max-w-6xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-sm sm:text-sm font-bold text-foreground tracking-tight">
            Query Execution Plan
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Run EXPLAIN ANALYZE to visualize how your query is executed.
          </p>
        </div>

        <div className="space-y-3">
          <Textarea
            placeholder="SELECT * FROM ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-[100px] font-mono text-xs bg-background/50 border-studio-border"
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={handleExplain}
              disabled={loading || !query.trim()}
              size="sm"
              className="h-7 text-xs gap-1.5"
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Brain className="w-3 h-3" />
              )}
              {loading ? "Analyzing..." : "Explain"}
            </Button>
          </div>
        </div>

        {planQuery && (
          <div className="text-xs text-muted-foreground font-mono bg-muted/20 p-2 rounded-lg">
            <span className="text-foreground/60">Plan query:</span> {planQuery}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Running EXPLAIN ANALYZE...
          </div>
        )}

        {error && !plan && (
          <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-semibold text-amber-500">
                {planQuery && !planQuery.toLowerCase().includes("analyze")
                  ? "Estimated Plan"
                  : "Plan Output"}
              </span>
            </div>
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
              {error}
            </pre>
          </div>
        )}

        {plan && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {plan["Planning Time"] !== undefined && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Planning:{" "}
                  <span className="font-mono text-foreground">
                    {plan["Planning Time"].toFixed(3)}ms
                  </span>
                </span>
              )}
              {plan["Execution Time"] !== undefined && (
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Execution:{" "}
                  <span className="font-mono text-foreground">
                    {plan["Execution Time"].toFixed(3)}ms
                  </span>
                </span>
              )}
            </div>

            <div className="bg-background/20 border border-studio-border rounded-lg p-2">
              <PlanNodeCard node={getPlanNode(plan)!} depth={0} />
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Legend:</span>
              <div className="flex flex-wrap gap-4 mt-1">
                <span className="flex items-center gap-1">
                  <HardDrive className="w-2.5 h-2.5" /> Cost
                </span>
                <span className="flex items-center gap-1">
                  <Database className="w-2.5 h-2.5" /> Rows
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> Loops
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" /> Time
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
