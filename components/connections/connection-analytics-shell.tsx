"use client";

import { ConnectionAnalytics } from "./connection-analytics";
import { Connection } from "@/lib/db/schema";
import { BarChart3 } from "@/lib/icon-theme/lucide-react";

export function ConnectionAnalyticsShell({
  connectionId,
  connection,
  onClose,
}: {
  connectionId?: number | null;
  connection?: Connection | null;
  onClose?: () => void;
}) {
  if (!connectionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-lg bg-muted flex items-center justify-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-medium">No Connection Selected</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Select a connection from the sidebar to view analytics
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <ConnectionAnalytics
        connectionId={connectionId}
        connection={connection}
      />
    </div>
  );
}
