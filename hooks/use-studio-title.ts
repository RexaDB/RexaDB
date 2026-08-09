import { useEffect } from "react";
import type { Connection } from "@/lib/db/schema";

export function useStudioTitle(connection: Connection | null, loading: boolean) {
  useEffect(() => {
    if (loading) return;

    if (!connection) {
      document.title = "Connection not found";
      return;
    }

    document.title = connection.name || "Rexa DB Studio";
  }, [connection, loading]);
}
