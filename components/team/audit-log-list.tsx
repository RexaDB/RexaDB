"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { History } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { studioApi } from "@/lib/studio-backend/api-client";
import { toast } from "sonner";
import { LogLoadingState, LogTable, LogUserCell, LogPageLayout } from "@/components/team/log-utils";
import type { ApiResponse } from "@/lib/studio-backend/types";

interface AuditLog {
  ts: number;
  method: string;
  url: string;
  status: number;
  reqHeaders?: Record<string, string>;
  resBody?: unknown;
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    role?: { id: number; name: string } | null;
  };
}

export function AuditLogList() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    studioApi
      .get<ApiResponse<AuditLog[]>>("/audit-logs")
      .then((res) => setLogs(res.data || []))
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load audit logs",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LogLoadingState loading />;

  return (
    <LogPageLayout
      title="Audit Logs"
      description="Track all administrative actions"
      emptyIcon={History}
      emptyText="No audit logs yet"
      isEmpty={logs.length === 0}
    >
      <LogTable headers={["Timestamp", "Method", "URL", "Status", "User"]}>
        {logs.map((log, idx) => (
              <tr key={idx} className="hover:bg-studio-bg/80">
                <td className="px-4 py-2.5 text-muted-foreground">
                  {new Date(log.ts).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs">{log.method}</span>
                </td>
                <td className="px-4 py-2.5 max-w-[300px] truncate font-mono text-xs">
                  {log.url}
                </td>
                <td className="px-4 py-2.5">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      log.status < 300
                        ? "text-emerald-500 border-emerald-500/30"
                        : log.status < 500
                          ? "text-amber-500 border-amber-500/30"
                          : "text-destructive border-destructive/30",
                    )}
                  >
                    {log.status}
                  </Badge>
                </td>
                <td
                  className="px-4 py-2.5 max-w-[200px] truncate text-xs text-muted-foreground"
                  title={log.user?.email}
                >
                  {log.user && <LogUserCell user={log.user} />}
                </td>
              </tr>
            ))}
      </LogTable>
    </LogPageLayout>
  );
}
