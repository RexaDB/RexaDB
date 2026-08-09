"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2, RefreshCw } from "@/lib/icon-theme/lucide-react";
import { isDesktopRuntime } from "@/lib/desktop";

interface HistoryLogEntry {
  timestamp: number;
  operation: "load" | "save" | "add" | "clear" | "error";
  connectionId: number;
  connectionName?: string;
  historyCount?: number;
  details?: any;
  error?: string;
}

export function HistoryDebugViewer() {
  const [logs, setLogs] = useState<HistoryLogEntry[]>([]);
  const [logPath, setLogPath] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const isDesktop = isDesktopRuntime();

  const loadLogs = async () => {
    if (!isDesktop) return;

    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = (await invoke("history_debug_get_logs")) as {
        success: boolean;
        logs?: HistoryLogEntry[];
      };
      if (result.success) {
        setLogs(result.logs || []);
      }
    } catch (error) {
      console.error("Failed to load debug logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!isDesktop) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = (await invoke("history_debug_clear_logs")) as {
        success: boolean;
      };
      if (result.success) {
        setLogs([]);
      }
    } catch (error) {
      console.error("Failed to clear debug logs:", error);
    }
  };

  const openLogFile = async () => {
    if (!isDesktop || !logPath) return;

    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(logPath);
    } catch (error) {
      console.error("Failed to open log file:", error);
    }
  };

  useEffect(() => {
    if (!isDesktop) return;

    const loadLogPath = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = (await invoke("history_debug_get_log_path")) as {
          success: boolean;
          path?: string;
        };
        if (result.success) {
          setLogPath(result.path || "");
        }
      } catch (error) {
        console.error("Failed to get log path:", error);
      }
    };

    loadLogPath();
    loadLogs();
  }, []);

  if (!isDesktop) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        History debug logging is only available in the desktop app.
      </div>
    );
  }

  const getOperationColor = (operation: string) => {
    switch (operation) {
      case "load":
        return "bg-blue-500/10 text-blue-500";
      case "save":
        return "bg-green-500/10 text-green-500";
      case "add":
        return "bg-purple-500/10 text-purple-500";
      case "clear":
        return "bg-orange-500/10 text-orange-500";
      case "error":
        return "bg-red-500/10 text-red-500";
      default:
        return "bg-gray-500/10 text-gray-500";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-sm font-semibold">Query History Debug Logs</h2>
          <p className="text-sm text-muted-foreground">
            Track all query history operations across connections
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadLogs}
            disabled={loading}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {logPath && (
            <Button variant="outline" size="sm" onClick={openLogFile}>
              <FileText className="w-4 h-4 mr-2" />
              Open File
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={clearLogs}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      {logPath && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/30">
          Log file: {logPath}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No debug logs yet. Logs will appear as you use query history.
            </div>
          ) : (
            logs
              .slice()
              .reverse()
              .map((log, index) => (
                <div
                  key={index}
                  className="p-3 rounded-lg border bg-card text-card-foreground"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className={getOperationColor(log.operation)}>
                        {log.operation}
                      </Badge>
                      <span className="text-sm font-mono">
                        Connection #{log.connectionId}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>

                  {log.historyCount !== undefined && (
                    <div className="text-sm mb-1">
                      History count: {log.historyCount}
                    </div>
                  )}

                  {log.error && (
                    <div className="text-sm text-red-500 mb-1">
                      Error: {log.error}
                    </div>
                  )}

                  {log.details && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Details
                      </summary>
                      <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
