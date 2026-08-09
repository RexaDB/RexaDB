import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown } from "@/lib/icon-theme/lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";

const CHART_COLORS = [
  "var(--primary)",
  "hsl(38, 92%, 50%)",
  "var(--accent)",
  "var(--muted-foreground)",
  "hsl(220, 70%, 50%)",
  "hsl(160, 70%, 50%)",
  "hsl(280, 70%, 50%)",
];

export function AnalyticsLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-lg h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Loading analytics...</p>
      </div>
    </div>
  );
}

export function AnalyticsError() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">Failed to load analytics</p>
    </div>
  );
}

const DEFAULT_TOOLTIP_STYLE = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
} as const;

export function StatCard({
  title,
  value,
  icon,
  trend,
  subtitle,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          {icon}
        </div>
        <div className="mt-2 flex items-end gap-1">
          <p className="text-2xl font-semibold">{value}</p>
          {trend && (
            <span
              className={cn(
                "text-xs mb-1",
                trend === "up" && "text-green-600",
                trend === "down" && "text-red-600",
                trend === "neutral" && "text-muted-foreground",
              )}
            >
              {trend === "up" && <ArrowUp className="h-3 w-3 inline" />}
              {trend === "down" && <ArrowDown className="h-3 w-3 inline" />}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function AreaChartCard({
  data,
  title,
  icon,
  gradientId = "colorArea",
}: {
  data: Array<{ date: string; count: number }>;
  title: string;
  icon: React.ReactNode;
  gradientId?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--primary)"
                  stopOpacity={0.3}
                />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickFormatter={(val: string) => val.slice(5)}
              className="text-muted-foreground"
            />
            <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
            <Tooltip contentStyle={DEFAULT_TOOLTIP_STYLE} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--primary)"
              fillOpacity={1}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function PieChartCard({
  data,
  title,
  icon,
}: {
  data: Array<{ name: string; value: number }>;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={data as any}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={(entry: any) => `${entry.name}: ${entry.value}`}
              outerRadius={80}
              fill="var(--primary)"
              dataKey="value"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={DEFAULT_TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function VerticalBarChartCard({
  data,
  title,
  icon,
  yDataKey,
  yWidth = 100,
  emptyMessage = "No data available",
}: {
  data: Array<Record<string, any>>;
  title: string;
  icon: React.ReactNode;
  yDataKey: string;
  yWidth?: number;
  emptyMessage?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {emptyMessage}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.slice(0, 8)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                type="number"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis
                type="category"
                dataKey={yDataKey}
                tick={{ fontSize: 12 }}
                width={yWidth}
                className="text-muted-foreground"
              />
              <Tooltip contentStyle={DEFAULT_TOOLTIP_STYLE} />
              <Bar
                dataKey="count"
                fill="var(--primary)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function TopQueriesCard({
  data,
  title = "Top Queries",
  description,
  emptyMessage = "No query history",
}: {
  data: Array<{ query: string; count: number }>;
  title?: string;
  description?: string;
  emptyMessage?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {emptyMessage}
          </p>
        ) : (
          <div className="space-y-2">
            {data.slice(0, 5).map((q, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Badge variant="secondary" className="shrink-0 mt-0.5">
                  {q.count}x
                </Badge>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate flex-1">
                  {q.query}
                </code>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
