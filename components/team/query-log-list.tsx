"use client";

import { useState, useEffect } from "react";
import { FileText } from "@/lib/icon-theme/lucide-react";
import { studioApi } from "@/lib/studio-backend/api-client";
import { toast } from "sonner";
import { LogLoadingState, LogTable, LogUserCell, LogPageLayout } from "@/components/team/log-utils";
import type { ApiResponse } from "@/lib/studio-backend/types";

interface QueryLog {
  id: number;
  connectionId: string;
  userId: string;
  query: string;
  duration: number;
  executedAt: string;
  connection: { id: string; name: string; type: string };
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    role?: { id: number; name: string } | null;
  };
}

export function QueryLogList() {
  const [logs, setLogs] = useState<QueryLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    studioApi
      .get<ApiResponse<QueryLog[]>>("/query-logs")
      .then((res) => setLogs(res.data || []))
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to load query logs",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LogLoadingState loading />;

  return (
    <LogPageLayout
      title="Query Logs"
      description="View executed queries across connections"
      emptyIcon={FileText}
      emptyText="No query logs yet"
      isEmpty={logs.length === 0}
    >
      <LogTable headers={["Query", "Connection", "Duration", "User", "Date"]}>
        {logs.map((log) => (
          <tr key={log.id} className="hover:bg-studio-bg/80">
            <td className="px-4 py-2.5 max-w-[300px] truncate font-mono text-xs">
              {log.query}
            </td>
            <td className="px-4 py-2.5 text-muted-foreground">
              {log.connection.name}
            </td>
            <td className="px-4 py-2.5">{log.duration}ms</td>
            <td className="px-4 py-2.5">
              <LogUserCell user={log.user} />
            </td>
            <td className="px-4 py-2.5 text-muted-foreground">
              {new Date(log.executedAt).toLocaleString()}
            </td>
          </tr>
        ))}
      </LogTable>
    </LogPageLayout>
  );
}
