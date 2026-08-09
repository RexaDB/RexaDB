import { type ReactNode, useState } from "react";
import { CircleCheck, CircleX, CircleAlert, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export type TimeRange = "1H" | "4H" | "24H" | "72H" | "7D" | "30D";

export interface ErrorRowData {
  id: string;
  workflow: string;
  errorType: string;
  total: number;
  failed: number;
  bar: { value: number; max: number };
}

export type RunStatus = "success" | "failed" | "running";

export interface RunRow {
  id: string;
  started: string;
  workflow: string;
  duration: string;
  status: RunStatus;
  error?: string;
  onRerun?: () => void;
}

export interface DashboardProps {
  queriesOverTime?: Array<{ date: string; count: number }>;
  queriesTotal?: number;
  queriesTrend?: number;
  queriesTrendLabel?: string;
  rightPanel?: ReactNode;
  errorsTotal?: number;
  errorsTrend?: number;
  errorsTrendLabel?: string;
  errors?: { title?: string; rows: ErrorRowData[] };
  runs: {
    rows: RunRow[];
    historyRows?: RunRow[];
  };
  onConnect?: () => void;
  className?: string;
}

function Pill({
  children,
  active,
  className,
  ...rest
}: { active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm font-medium transition",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function DurationCell({ children }: { children: string }) {
  const ms = parseInt(children, 10);
  const cls = ms < 50 ? "text-success" : ms < 200 ? "text-warning" : "text-destructive";
  return <span className={cls}>{children}</span>;
}

function StatusBadge({ status }: { status: RunStatus }) {
  const map = {
    success: {
      icon: <CircleCheck className="h-3.5 w-3.5" />,
      label: "Success",
      cls: "bg-[color-mix(in_srgb,var(--success)_12%,var(--card))] text-success border-[color-mix(in_srgb,var(--success)_25%,var(--border))]",
    },
    failed: {
      icon: <CircleX className="h-3.5 w-3.5" />,
      label: "Failed",
      cls: "bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive border-[color-mix(in_srgb,var(--destructive)_25%,var(--border))]",
    },
    running: {
      icon: <CircleAlert className="h-3.5 w-3.5" />,
      label: "Running",
      cls: "bg-muted text-muted-foreground border-border",
    },
  }[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium", map.cls)}>
      {map.icon}
      {map.label}
    </span>
  );
}

function RunHistoryRow({
  r,
  truncate,
  copiedId,
  onCopy,
}: {
  r: RunRow;
  truncate?: boolean;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <TableRow key={r.id}>
      <TableCell className="text-muted-foreground">{r.started}</TableCell>
      <TableCell
        className={cn("group relative font-mono text-xs", truncate && "max-w-[300px] truncate text-foreground")}
        title={truncate ? r.workflow : undefined}
      >
        {r.workflow}
        <button onClick={() => onCopy(r.workflow, `q-${r.id}`)} className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted">
          {copiedId === `q-${r.id}` ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </TableCell>
      <TableCell className="text-muted-foreground"><DurationCell>{r.duration}</DurationCell></TableCell>
      <TableCell><StatusBadge status={r.status} /></TableCell>
      <TableCell className="group relative text-muted-foreground">
        {r.error ?? ""}
        {r.error && (
          <button onClick={() => onCopy(r.error!, `e-${r.id}`)} className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted">
            {copiedId === `e-${r.id}` ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </TableCell>
    </TableRow>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  fontSize: "12px",
} as const;

function QueriesChart({ data }: { data: Array<{ date: string; count: number }> }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
        No query data available
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v: string, i: number) => i === 0 || i === data.length - 1 ? v.slice(5) : ""} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="count" fill="var(--success)" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface SchemaTableInfo {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
  referenced_table?: string;
}

export function Dashboard({
  queriesOverTime,
  queriesTotal,
  queriesTrend,
  queriesTrendLabel,
  rightPanel,
  errorsTotal,
  errorsTrend,
  errorsTrendLabel,
  errors,
  runs,
  onConnect,
  className,
}: DashboardProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 flex-col bg-background text-foreground",
        className,
      )}
    >
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
        <div className="flex w-full min-w-0 flex-col gap-5">
          <div className="flex w-full items-center justify-end">
            {onConnect && (
              <button onClick={onConnect} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
                Connect
              </button>
            )}
          </div>
          <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex h-[380px] min-w-0 flex-col rounded-2xl bg-card p-5">
              <div className="mb-1 flex shrink-0 items-center justify-between">
                <span className="text-sm text-muted-foreground">Queries over time</span>
                {queriesTrend != null && (
                  <span className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-medium border", queriesTrend >= 0 ? "bg-[color-mix(in_srgb,var(--success)_12%,var(--card))] text-success border-[color-mix(in_srgb,var(--success)_25%,var(--border))]" : "bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive border-[color-mix(in_srgb,var(--destructive)_25%,var(--border))]")}>
                    {queriesTrend >= 0 ? "+" : ""}{queriesTrend}%{queriesTrendLabel ? ` ${queriesTrendLabel}` : ""}
                  </span>
                )}
              </div>
              <div className="mb-3 shrink-0 text-2xl font-medium tracking-tight text-foreground">{queriesTotal ?? 0}</div>
              <div className="min-h-0 w-full min-w-0 flex-1">
                <QueriesChart data={queriesOverTime ?? []} />
              </div>
            </div>
            <div className="relative flex h-[380px] min-w-0 flex-col overflow-hidden rounded-2xl bg-card">
              {rightPanel}
            </div>
          </div>

          {errors && errors.rows.length > 0 && (
            <div className="flex flex-col rounded-2xl bg-card p-5">
              <div className="mb-4">
                <span className="text-sm text-muted-foreground">{errors?.title ?? "Most errored"}</span>
              </div>
              <div className="flex flex-col gap-3">
                {errors.rows.map((row) => (
                  <div key={row.id} className="grid grid-cols-[1fr_auto] gap-y-1.5">
                    <div className="text-sm text-foreground">{row.workflow}</div>
                    <div className="text-sm tabular-nums text-muted-foreground">
                      {row.total}
                      <span className="text-foreground"> / </span>
                      <span className="text-primary">{row.failed}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="mr-1 text-muted-foreground/60">└</span>
                      {row.errorType}
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <div className="h-[3px] w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${(row.bar.value / row.bar.max) * 100}%` }} />
                      </div>
                      <span className="w-4 text-right text-xs text-primary">{row.bar.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex w-full min-w-0 flex-col rounded-2xl bg-card">
            <div className="px-5 pt-4 pb-2 text-base font-semibold text-foreground">History</div>
            <div className="w-full min-w-0 px-4 pb-4">
            <div className="w-full min-w-0 overflow-hidden rounded-lg border border-[var(--border)] transform-gpu">
            <Table className="w-full [&_th]:border-r [&_th]:border-b [&_td]:border-r [&_td]:border-b [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_tr:last-child_td]:border-b-0" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {(runs.historyRows ?? []).map((r) => (
                    <RunHistoryRow key={r.id} r={r} truncate copiedId={copiedId} onCopy={handleCopy} />
                  ))}
                {(runs.historyRows ?? []).length === 0 && runs.rows.map((r) => (
                  <RunHistoryRow key={r.id} r={r} copiedId={copiedId} onCopy={handleCopy} />
                ))}
              </TableBody>
            </Table>
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
